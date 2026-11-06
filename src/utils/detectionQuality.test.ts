import { describe, expect, it } from "vitest";
import {
  CONDITION_SPLITS,
  buildDetectionRecord,
  frameLuma,
  groupByCondition,
  groupByNeighborDistance,
  nearestNeighborMm,
  evaluateLegacy,
  evaluateRecorded,
  groupByModel,
  groupByPeriod,
  meanOf,
  parseDetectionRecord,
  shareWithin,
  type QualitySample,
  type RoundContext,
} from "./detectionQuality";

const snap = (u: number, v: number, baseValue = 20, multiplier = 1, confidence = 0.8) => ({ baseValue, multiplier, confidence, boardU: u, boardV: v });

describe("buildDetectionRecord", () => {
  it("classifies unchanged, moved, value-changed and added darts", () => {
    const record = buildDetectionRecord(
      [
        { baseValue: 20, multiplier: 1, boardU: 0, boardV: -0.5, detected: snap(0, -0.5) },
        { baseValue: 20, multiplier: 1, boardU: 0.1, boardV: -0.5, detected: snap(0, -0.5) },
        { baseValue: 5, multiplier: 1, boardU: 0, boardV: -0.5, detected: snap(0, -0.5) },
        { baseValue: 0, multiplier: 1 },
        { baseValue: 19, multiplier: 3 },
      ],
      [{}],
      "m1",
    );
    expect(record.darts.map((d) => d.outcome)).toEqual(["unchanged", "moved", "valueChanged", "addedMiss", "added"]);
    expect(record.darts[1].distanceMm).toBeCloseTo(17, 5);
    expect(record.removed).toBe(1);
  });

  it("leaves the distance unknown without positions", () => {
    const record = buildDetectionRecord([{ baseValue: 20, multiplier: 1, detected: { baseValue: 20, multiplier: 1, confidence: 0.5 } }], [], "m1");
    expect(record.darts[0]).toEqual({ outcome: "unchanged", distanceMm: null, confidence: 0.5, neighborMm: null });
  });
});

const sample = (createdAt: string, outcomes: ("unchanged" | "moved")[], model = "m1", removed = 0): QualitySample => ({
  createdAt,
  labels: [],
  detection: {
    version: 1,
    model,
    removed,
    darts: outcomes.map((outcome) => ({ outcome, distanceMm: outcome === "moved" ? 10 : 0, confidence: 0.7 })),
  },
});

describe("evaluateRecorded", () => {
  it("counts rounds, untouched rounds and distances", () => {
    const f = evaluateRecorded([sample("2026-10-20T10:00:00Z", ["unchanged", "unchanged"]), sample("2026-10-21T10:00:00Z", ["unchanged", "moved"], "m1", 1)]);
    expect(f.rounds).toBe(2);
    expect(f.untouchedRounds).toBe(1);
    expect(f.darts).toBe(4);
    expect(f.counts).toMatchObject({ unchanged: 3, moved: 1, removed: 1 });
    expect(meanOf(f.distances)).toBe(2.5);
    expect(shareWithin(f.distances, 8.5)).toBe(0.75);
  });

  it("ignores samples without a record", () => {
    expect(evaluateRecorded([{ createdAt: "2026-10-20T10:00:00Z", labels: [], detection: null }]).rounds).toBe(0);
  });
});

describe("evaluateLegacy", () => {
  it("reads snapped and confidence-1 labels as corrections", () => {
    const f = evaluateLegacy([
      { createdAt: "2026-10-20", detection: null, labels: [{ confidence: 0.7 }, { confidence: 0.6 }] },
      { createdAt: "2026-10-20", detection: null, labels: [{ confidence: 0.7 }, { confidence: 1 }, { snapped: true, confidence: 1 }] },
    ]);
    expect(f).toMatchObject({ unusableRounds: 0, rounds: 2, darts: 5, valueCorrected: 1, handPlaced: 1, detectorOnly: 3, untouchedRounds: 1 });
  });
});

it("sets aside samples from before confidence was meaningful", () => {
  const f = evaluateLegacy([{ createdAt: "2026-08-20", detection: null, labels: [{ confidence: 1 }] }]);
  expect(f).toMatchObject({ unusableRounds: 1, rounds: 0, darts: 0 });
});

describe("grouping", () => {
  const samples = [sample("2026-10-19T10:00:00Z", ["unchanged"], "a"), sample("2026-10-25T10:00:00Z", ["moved"], "b"), sample("2026-10-26T10:00:00Z", ["unchanged"], "b")];
  it("groups by ISO week starting Monday", () => {
    expect(groupByPeriod(samples, "week").map((p) => [p.period, p.figures.rounds])).toEqual([["2026-10-19", 2], ["2026-10-26", 1]]);
  });
  it("groups by day", () => {
    expect(groupByPeriod(samples, "day")).toHaveLength(3);
  });
  it("groups by model", () => {
    expect(groupByModel(samples).map((g) => [g.model, g.figures.rounds])).toEqual([["a", 1], ["b", 2]]);
  });
});

describe("parseDetectionRecord", () => {
  it("rejects missing or foreign shapes", () => {
    expect(parseDetectionRecord(null)).toBeNull();
    expect(parseDetectionRecord({ detection: { version: 2 } })).toBeNull();
    expect(parseDetectionRecord({ detection: { version: 1, darts: [{ outcome: "moved", distanceMm: 3, confidence: 1 }] } })?.model).toBe("unbekannt");
  });
});

describe("round context", () => {
  it("measures brightness and contrast of a picture", () => {
    const flat = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(100) };
    expect(frameLuma(flat)).toEqual({ brightness: 100, contrast: 0 });
    const split = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 200, 200, 200, 255]) };
    expect(frameLuma(split)).toEqual({ brightness: 100, contrast: 100 });
    expect(frameLuma({ width: 0, height: 0, data: [] })).toBeNull();
  });

  it("round-trips the context and ignores junk", () => {
    const record = buildDetectionRecord([], [], "v", { brightness: 90, refits: 1, calibSource: "auto" });
    expect(parseDetectionRecord({ detection: record })?.context).toEqual({ brightness: 90, refits: 1, calibSource: "auto", contrast: undefined, calibQuality: undefined });
    expect(parseDetectionRecord({ detection: { ...record, context: { brightness: "x" } } })?.context).toBeUndefined();
  });

  it("splits recorded rounds by condition and skips rounds without that fact", () => {
    const sample = (context?: RoundContext): QualitySample => ({
      createdAt: "2026-11-01T10:00:00Z",
      labels: [],
      detection: buildDetectionRecord([], [], "v", context),
    });
    const brightness = CONDITION_SPLITS.find((s) => s.id === "brightness")!.bucket;
    const rows = groupByCondition([sample({ brightness: 50 }), sample({ brightness: 60 }), sample({ brightness: 120 }), sample()], brightness);
    expect(rows.map((r) => [r.label, r.figures.rounds])).toEqual([["dunkel (<80)", 2], ["mittel (80–170)", 1]]);
  });
});

describe("flagged darts and neighbour distance", () => {
  it("finds the nearest neighbour in mm", () => {
    const darts = [{ boardU: 0, boardV: 0 }, { boardU: 0.1, boardV: 0 }, { boardU: 0.8, boardV: 0 }, {}];
    expect(nearestNeighborMm(darts, 0)).toBeCloseTo(17, 5);
    expect(nearestNeighborMm(darts, 2)).toBeCloseTo(0.7 * 170, 5);
    expect(nearestNeighborMm(darts, 3)).toBeNull();
    expect(nearestNeighborMm([{ boardU: 0, boardV: 0 }], 0)).toBeNull();
  });

  it("records a flagged dart as an error, not as unchanged", () => {
    const detected = { baseValue: 20, multiplier: 1, confidence: 0.7, boardU: 0, boardV: 0 };
    const record = buildDetectionRecord([{ baseValue: 20, multiplier: 1, boardU: 0, boardV: 0, detected, flaggedWrong: true }], [], "v");
    expect(record.darts[0].outcome).toBe("flagged");
    const figures = evaluateRecorded([{ createdAt: "2026-11-01T10:00:00Z", labels: [], detection: record }]);
    expect(figures.counts.flagged).toBe(1);
    expect(figures.untouchedRounds).toBe(0);
  });

  it("splits darts by neighbour distance", () => {
    const detected = (u: number) => ({ baseValue: 20, multiplier: 1, confidence: 0.9, boardU: u, boardV: 0 });
    const tight = [
      { baseValue: 20, multiplier: 1, boardU: 0, boardV: 0, detected: detected(0) },
      { baseValue: 20, multiplier: 1, boardU: 0.05, boardV: 0, detected: detected(0.05), flaggedWrong: true },
    ];
    const rows = groupByNeighborDistance([{ createdAt: "2026-11-01T10:00:00Z", labels: [], detection: buildDetectionRecord(tight, [], "v") }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Kopf an Kopf (<12 mm)", darts: 2, unchanged: 1, flagged: 1 });
  });
});
