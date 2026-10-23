import { describe, it, expect } from "vitest";
import { neighbourSegments, canonicalPointForChoice, choiceLabel, type ScoreChoice } from "./dartCorrection";
import { scoreFromCanonicalPoint } from "./cameraGeometry";
import { SEGMENTS_CLOCKWISE } from "./dartboardGeometry";

describe("neighbourSegments", () => {
  it("lists the two segments on each side along the board", () => {
    expect(neighbourSegments(20)).toEqual([12, 5, 20, 1, 18]);
    expect(neighbourSegments(3)).toEqual([2, 17, 3, 19, 7]);
  });
  it("returns nothing for miss and bull", () => {
    expect(neighbourSegments(0)).toEqual([]);
    expect(neighbourSegments(25)).toEqual([]);
  });
});

describe("canonicalPointForChoice", () => {
  it("lands every single, double and treble of every segment exactly on that score", () => {
    for (const base of SEGMENTS_CLOCKWISE) {
      for (const multiplier of [1, 2, 3] as const) {
        for (const near of [null, { x: 0.3, y: -0.4 }, { x: -0.7, y: 0.5 }]) {
          const p = canonicalPointForChoice({ baseValue: base, multiplier }, near);
          const s = scoreFromCanonicalPoint(p.x, p.y);
          expect([s.baseValue, s.multiplier]).toEqual([base, multiplier]);
        }
      }
    }
  });
  it("handles bull, outer bull and miss", () => {
    const bull = canonicalPointForChoice({ baseValue: 25, multiplier: 2 }, null);
    expect(scoreFromCanonicalPoint(bull.x, bull.y).points).toBe(50);
    const outer = canonicalPointForChoice({ baseValue: 25, multiplier: 1 }, { x: 0.5, y: 0.5 });
    expect(scoreFromCanonicalPoint(outer.x, outer.y).points).toBe(25);
    const miss = canonicalPointForChoice({ baseValue: 0, multiplier: 1 }, { x: 0.2, y: -0.2 });
    expect(scoreFromCanonicalPoint(miss.x, miss.y).points).toBe(0);
  });
  it("keeps the dart's own angle when only the ring changes", () => {
    const near = { x: 0.04, y: -0.5 }; // inside segment 20, slightly right of centre
    const p = canonicalPointForChoice({ baseValue: 20, multiplier: 3 }, near);
    expect(p.x).toBeGreaterThan(0.02);
  });
});

describe("choiceLabel", () => {
  it("formats like the rest of the app", () => {
    const l = (c: ScoreChoice) => choiceLabel(c);
    expect(l({ baseValue: 20, multiplier: 3 })).toBe("T20");
    expect(l({ baseValue: 16, multiplier: 2 })).toBe("D16");
    expect(l({ baseValue: 7, multiplier: 1 })).toBe("7");
    expect(l({ baseValue: 25, multiplier: 2 })).toBe("Bull");
    expect(l({ baseValue: 0, multiplier: 1 })).toBe("0");
  });
});
