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

  it("rejects a weak phantom detection with no change under it", () => {
    expect(selectNewDart([], [{ x: 0.2, y: 0.8, confidence: 0.45 }], support)).toBeNull();
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

describe("weak detections", () => {
  const strongSupport = (x: number, y: number) => (Math.hypot(x - 0.6, y - 0.4) < 0.04 ? 0.5 : Math.hypot(x - 0.3, y - 0.7) < 0.04 ? 0.2 : 0);

  it("accepts a weak detection only with clearly fresh change under it", () => {
    expect(selectNewDart([], [{ x: 0.6, y: 0.4, confidence: 0.18 }], strongSupport)).not.toBeNull();
    expect(selectNewDart([], [{ x: 0.3, y: 0.7, confidence: 0.18 }], strongSupport)).toBeNull(); // 0.2 support is not enough for a weak one
    expect(selectNewDart([], [{ x: 0.3, y: 0.7, confidence: 0.4 }], strongSupport)).not.toBeNull(); // ...but is for a normal one
  });
});

describe("selectNewDarts", () => {
  const twoSpots = (x: number, y: number) => (Math.hypot(x - 0.6, y - 0.4) < 0.04 || Math.hypot(x - 0.3, y - 0.7) < 0.04 ? 0.6 : 0);

  it("takes every new dart of one picture (quick throws)", () => {
    const found = selectNewDarts([], [{ x: 0.6, y: 0.4, confidence: 0.5 }, { x: 0.3, y: 0.7, confidence: 0.4 }, { x: 0.8, y: 0.1, confidence: 0.45 }], twoSpots, 3);
    expect(found.map((d) => d.x)).toEqual([0.6, 0.3]);
  });

  it("never takes more than the room left in the round", () => {
    const found = selectNewDarts([], [{ x: 0.6, y: 0.4, confidence: 0.5 }, { x: 0.3, y: 0.7, confidence: 0.4 }], twoSpots, 1);
    expect(found).toHaveLength(1);
  });
});

describe("one landing, one dart", () => {
  const everywhere = () => 0.8;
  it("keeps only the best of several hits on the same dart (tip, barrel, flight)", () => {
    const hits = [{ x: 0.2, y: 0.6, confidence: 0.54 }, { x: 0.215, y: 0.62, confidence: 0.4 }, { x: 0.23, y: 0.58, confidence: 0.3 }];
    const picked = selectNewDarts([], hits, everywhere, 3);
    expect(picked).toHaveLength(1);
    expect(picked[0].confidence).toBe(0.54);
  });

  it("still takes two darts that landed in one look at different places", () => {
    const hits = [{ x: 0.2, y: 0.6, confidence: 0.54 }, { x: 0.7, y: 0.3, confidence: 0.5 }];
    expect(selectNewDarts([], hits, everywhere, 3)).toHaveLength(2);
  });
});

describe("barrel and flight hits are not darts", () => {
  const everywhere = () => 0.9;
  it("drops a weak hit along the barrel of a stronger one (measured: tip 0.73, barrel 63 mm away at 0.26)", () => {
    const hits = [{ x: 0.497, y: 0.695, confidence: 0.73 }, { x: 0.471, y: 0.552, confidence: 0.26 }];
    expect(selectNewDarts([], hits, everywhere, 3)).toEqual([hits[0]]);
  });

  it("keeps a weak hit that is far from every stronger one", () => {
    const hits = [{ x: 0.2, y: 0.2, confidence: 0.73 }, { x: 0.8, y: 0.8, confidence: 0.26 }];
    expect(selectNewDarts([], hits, everywhere, 3)).toHaveLength(2);
  });

  it("keeps a second confident dart right next to the first (a real tight group)", () => {
    const hits = [{ x: 0.5, y: 0.5, confidence: 0.7 }, { x: 0.5, y: 0.585, confidence: 0.6 }];
    expect(selectNewDarts([], hits, everywhere, 3)).toHaveLength(2);
  });

  it("a shifted second hit on a known dart is no new dart, even when confident", () => {
    const known = [{ x: 0.5, y: 0.5 }];
    const reHit = [{ x: 0.5, y: 0.55, confidence: 0.7 }]; // 22 mm away, same dart
    const noFreshChange = () => 0.02;
    expect(selectNewDarts(known, reHit, noFreshChange, 3)).toHaveLength(0);
  });

  it("a confident dart far from every known one needs no fresh change", () => {
    const known = [{ x: 0.2, y: 0.2 }];
    const far = [{ x: 0.7, y: 0.7, confidence: 0.7 }];
    expect(selectNewDarts(known, far, () => 0, 3)).toHaveLength(1);
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

describe("a hit on a known dart's own tip", () => {
  it("is never a new dart, even with strong fresh change under it", () => {
    const known = [{ x: 0.524, y: 0.303 }];
    expect(selectNewDart(known, [{ x: 0.5241, y: 0.3021, confidence: 0.72 }], () => 1)).toBeNull();
    expect(selectNewDarts(known, [{ x: 0.525, y: 0.304, confidence: 0.9 }], () => 1, 3)).toEqual([]);
  });

  it("still takes a real dart a few centimetres away", () => {
    const known = [{ x: 0.524, y: 0.303 }];
    expect(selectNewDart(known, [{ x: 0.506, y: 0.165, confidence: 0.6 }], () => 1)).not.toBeNull();
  });
});
