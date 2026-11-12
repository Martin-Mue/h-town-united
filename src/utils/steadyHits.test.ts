import { describe, it, expect } from "vitest";
import { trackSteadyHits, selectSteadyNewDarts, STEADY_HIT_LOOKS, type SteadyHit } from "./steadyHits";

const R = 0.035;

describe("trackSteadyHits", () => {
  it("counts a confident hit up while it stays on its spot", () => {
    let track: SteadyHit[] = [];
    for (let i = 0; i < 3; i++) track = trackSteadyHits(track, [{ x: 0.309 + i * 0.001, y: 0.455, confidence: 0.85 }]);
    expect(track).toHaveLength(1);
    expect(track[0].looks).toBe(3);
  });

  it("restarts a hit that moved and drops one that vanished", () => {
    let track = trackSteadyHits([], [{ x: 0.3, y: 0.4, confidence: 0.9 }, { x: 0.6, y: 0.6, confidence: 0.9 }]);
    track = trackSteadyHits(track, [{ x: 0.32, y: 0.4, confidence: 0.9 }]);
    expect(track).toEqual([{ x: 0.32, y: 0.4, looks: 1 }]);
  });

  it("ignores weak hits (phantoms, the corner ghost)", () => {
    expect(trackSteadyHits([], [{ x: 0.1, y: 0.03, confidence: 0.24 }])).toEqual([]);
  });
});

describe("selectSteadyNewDarts", () => {
  const steady: SteadyHit[] = [
    { x: 0.309, y: 0.455, looks: STEADY_HIT_LOOKS },
    { x: 0.409, y: 0.557, looks: STEADY_HIT_LOOKS },
    { x: 0.5, y: 0.5, looks: 1 },
  ];

  it("takes steady hits that no known dart explains (log 2026-11-12 05:17:47-05:18:10)", () => {
    const cands = [{ x: 0.309, y: 0.455, confidence: 0.85 }, { x: 0.409, y: 0.557, confidence: 0.82 }, { x: 0.5, y: 0.5, confidence: 0.9 }];
    const picked = selectSteadyNewDarts([], cands, steady, 3, R);
    expect(picked.map((p) => p.x)).toEqual([0.309, 0.409]);
  });

  it("does not re-add a known dart and respects the free slots", () => {
    const cands = [{ x: 0.309, y: 0.455, confidence: 0.85 }, { x: 0.409, y: 0.557, confidence: 0.82 }];
    expect(selectSteadyNewDarts([{ x: 0.31, y: 0.456 }], cands, steady, 3, R).map((p) => p.x)).toEqual([0.409]);
    expect(selectSteadyNewDarts([], cands, steady, 1, R)).toHaveLength(1);
  });
});
