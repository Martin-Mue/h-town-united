import { describe, expect, it } from "vitest";
import { markerPositionFor } from "./dartMarkerPosition";
import { scoreFromCanonicalPoint } from "./cameraGeometry";

describe("markerPositionFor", () => {
  it("lands every field of the board on exactly the value that was thrown", () => {
    for (let base = 1; base <= 20; base++) {
      for (const multiplier of [1, 2, 3]) {
        for (let seed = 0; seed < 40; seed++) {
          const { u, v } = markerPositionFor(base, multiplier, seed);
          const score = scoreFromCanonicalPoint(u, v);
          expect([base, multiplier, seed, score.baseValue, score.multiplier]).toEqual([base, multiplier, seed, base, multiplier]);
        }
      }
    }
  });

  it("scores the bull rings and puts a miss off the board", () => {
    for (let seed = 0; seed < 40; seed++) {
      const bull = markerPositionFor(50, 1, seed);
      expect(scoreFromCanonicalPoint(bull.u, bull.v).points).toBe(50);
      const outer = markerPositionFor(25, 1, seed);
      expect(scoreFromCanonicalPoint(outer.u, outer.v).points).toBe(25);
      const miss = markerPositionFor(0, 1, seed);
      expect(Math.hypot(miss.u, miss.v)).toBeGreaterThan(1.05);
      expect(scoreFromCanonicalPoint(miss.u, miss.v).points).toBe(0);
    }
  });

  it("is deterministic per seed and varies between seeds", () => {
    expect(markerPositionFor(20, 3, 7)).toEqual(markerPositionFor(20, 3, 7));
    expect(markerPositionFor(20, 3, 7)).not.toEqual(markerPositionFor(20, 3, 8));
  });
});
