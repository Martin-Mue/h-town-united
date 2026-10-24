import { describe, expect, it } from "vitest";
import {
  buildDetectionRecord,
  evaluateLegacy,
  evaluateRecorded,
  groupByModel,
  groupByPeriod,
  meanOf,
  parseDetectionRecord,
  shareWithin,
  type QualitySample,
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
    expect(record.darts[0]).toEqual({ outcome: "unchanged", distanceMm: null, confidence: 0.5 });
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
      { createdAt: "x", detection: null, labels: [{ confidence: 0.7 }, { confidence: 0.6 }] },
      { createdAt: "x", detection: null, labels: [{ confidence: 0.7 }, { confidence: 1 }, { snapped: true, confidence: 1 }] },
    ]);
    expect(f).toMatchObject({ rounds: 2, darts: 5, valueCorrected: 1, handPlaced: 1, detectorOnly: 3, untouchedRounds: 1 });
  });
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
