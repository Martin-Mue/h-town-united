import { describe, it, expect } from "vitest";
import { selectNewDart, selectNewDarts, keepSupportedDarts } from "./newDartSelection";

// A change map stand-in: changed pixels exist only around (0.6, 0.4).
const support = (x: number, y: number) => (Math.hypot(x - 0.6, y - 0.4) < 0.04 ? 0.6 : 0);

describe("selectNewDart", () => {
  it("picks the candidate on changed pixels, ignoring re-detected old darts", () => {
    const known = [{ x: 0.5, y: 0.3 }];
    const found = selectNewDart(known, [{ x: 0.5, y: 0.31, confidence: 0.9 }, { x: 0.6, y: 0.4, confidence: 0.3 }], support);
    expect(found?.x).toBe(0.6);
  });

  it("accepts a dart that sits right next to an earlier one when the change is strong there", () => {
    const known = [{ x: 0.6, y: 0.41 }];
    const found = selectNewDart(known, [{ x: 0.6, y: 0.4, confidence: 0.4 }], support);
    expect(found).not.toBeNull(); // 0.6 support >= the stricter near-known bar of 0.3
  });

  it("does not need the model to report fewer-or-more darts than are known", () => {
    // the model only sees the new dart (the old ones are hidden) — the old logic returned nothing here
    const known = [{ x: 0.5, y: 0.3 }, { x: 0.45, y: 0.35 }];
    expect(selectNewDart(known, [{ x: 0.6, y: 0.4, confidence: 0.2 }], support)?.y).toBe(0.4);
  });

  it("rejects a phantom detection with no change under it", () => {
    expect(selectNewDart([], [{ x: 0.2, y: 0.8, confidence: 0.95 }], support)).toBeNull();
  });

  it("without a comparison frame it falls back to the position check", () => {
    const known = [{ x: 0.5, y: 0.5 }];
    const found = selectNewDart(known, [{ x: 0.505, y: 0.5, confidence: 0.9 }, { x: 0.7, y: 0.5, confidence: 0.5 }], null);
    expect(found?.x).toBe(0.7);
  });

  it("skips candidates without a position", () => {
    expect(selectNewDart([], [{ confidence: 0.9 }], null)).toBeNull();
  });
});

describe("selectNewDarts", () => {
  const twoSpots = (x: number, y: number) => (Math.hypot(x - 0.6, y - 0.4) < 0.04 || Math.hypot(x - 0.3, y - 0.7) < 0.04 ? 0.6 : 0);

  it("takes every new dart of one picture (quick throws)", () => {
    const found = selectNewDarts([], [{ x: 0.6, y: 0.4, confidence: 0.5 }, { x: 0.3, y: 0.7, confidence: 0.4 }, { x: 0.8, y: 0.1, confidence: 0.9 }], twoSpots, 3);
    expect(found.map((d) => d.x)).toEqual([0.6, 0.3]);
  });

  it("never takes more than the room left in the round", () => {
    const found = selectNewDarts([], [{ x: 0.6, y: 0.4, confidence: 0.5 }, { x: 0.3, y: 0.7, confidence: 0.4 }], twoSpots, 1);
    expect(found).toHaveLength(1);
  });
});

describe("keepSupportedDarts", () => {
  it("drops a weak dart the next picture no longer shows, keeps strong ones and re-seen ones", () => {
    const known = [
      { x: 0.2, y: 0.2, confidence: 0.3 }, // phantom: gone
      { x: 0.5, y: 0.5, confidence: 0.3 }, // still there
      { x: 0.7, y: 0.7, confidence: 0.6 }, // strong: stays even if hidden
    ];
    const kept = keepSupportedDarts(known, [{ x: 0.51, y: 0.5 }]);
    expect(kept.map((d) => d.x)).toEqual([0.5, 0.7]);
  });
});
