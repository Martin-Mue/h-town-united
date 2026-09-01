import { describe, it, expect } from "vitest";
import {
  isAchievableVisitTotal, scoreTierBreakdown, segmentBreakdown, segmentCount,
  combineScoreTiers, combineSegmentCounts, first9Average,
  computeLegStatBundle, combineStatBundles, type DartThrow,
} from "./dartStats";

describe("isAchievableVisitTotal", () => {
  it("accepts common achievable totals", () => {
    for (const n of [0, 26, 41, 45, 60, 81, 85, 100, 121, 140, 170, 180]) {
      expect(isAchievableVisitTotal(n)).toBe(true);
    }
  });

  it("rejects the known-unreachable 3-dart totals", () => {
    for (const n of [163, 166, 169, 172, 173, 175, 176, 178, 179]) {
      expect(isAchievableVisitTotal(n)).toBe(false);
    }
  });

  it("rejects out-of-range and non-integer values", () => {
    expect(isAchievableVisitTotal(-1)).toBe(false);
    expect(isAchievableVisitTotal(181)).toBe(false);
    expect(isAchievableVisitTotal(50.5)).toBe(false);
  });
});

const d = (baseValue: number, multiplier: number): DartThrow => ({
  baseValue, multiplier, points: baseValue === 25 && multiplier === 3 ? 0 : baseValue * multiplier,
});
const visit = (...darts: DartThrow[]) => darts;
const throwsOf = (...visits: DartThrow[][]) => visits.flat();

describe("scoreTierBreakdown", () => {
  it("returns every tier at 0 for no throws", () => {
    const tiers = scoreTierBreakdown([]);
    expect(tiers.map((t) => t.label)).toEqual(["40+", "60+", "80+", "100+", "120+", "140+", "160+", "180"]);
    expect(tiers.every((t) => t.count === 0)).toBe(true);
  });

  it("leaves a sub-40 visit uncounted in every tier", () => {
    const throws = throwsOf(visit(d(5, 1), d(5, 1), d(5, 1))); // 15 points
    const tiers = scoreTierBreakdown(throws);
    expect(tiers.every((t) => t.count === 0)).toBe(true);
  });

  it("buckets band boundaries inclusively (60 and 79 both land in 60+)", () => {
    const throws = throwsOf(
      visit(d(20, 1), d(20, 1), d(20, 1)), // 60
      visit(d(20, 3), d(19, 1), d(0, 1)),  // 60+19 = 79
    );
    const tiers = scoreTierBreakdown(throws);
    expect(tiers.find((t) => t.label === "60+")!.count).toBe(2);
    expect(tiers.find((t) => t.label === "40+")!.count).toBe(0);
    expect(tiers.find((t) => t.label === "80+")!.count).toBe(0);
  });

  it("counts a 180 only in the 180 tier, not also in 160+", () => {
    const throws = throwsOf(visit(d(20, 3), d(20, 3), d(20, 3))); // 180
    const tiers = scoreTierBreakdown(throws);
    expect(tiers.find((t) => t.label === "180")!.count).toBe(1);
    expect(tiers.find((t) => t.label === "160+")!.count).toBe(0);
  });

  it("counts a short trailing checkout visit (fewer than 3 darts)", () => {
    // Final visit of a leg: T20 + D20 = 100, checked out in 2 darts.
    const throws = throwsOf(visit(d(20, 3), d(20, 2)));
    const tiers = scoreTierBreakdown(throws);
    expect(tiers.find((t) => t.label === "100+")!.count).toBe(1);
  });

  it("keeps per-tier counts independent across multiple visits", () => {
    const throws = throwsOf(
      visit(d(15, 1), d(15, 1), d(15, 1)), // 45 -> 40+
      visit(d(15, 1), d(15, 1), d(15, 1)), // 45 -> 40+
      visit(d(20, 3), d(20, 3), d(20, 2)), // 20*3 + 20*3 + 20*2 = 160 -> 160+
    );
    const tiers = scoreTierBreakdown(throws);
    expect(tiers.find((t) => t.label === "40+")!.count).toBe(2);
    expect(tiers.find((t) => t.label === "160+")!.count).toBe(1);
  });
});

describe("segmentBreakdown / segmentCount", () => {
  it("counts each exact baseValue+multiplier combination separately", () => {
    const throws = throwsOf(visit(d(20, 3), d(20, 3), d(1, 1)), visit(d(20, 3), d(16, 1), d(0, 1)));
    const sb = segmentBreakdown(throws);
    expect(segmentCount(sb, 20, 3)).toBe(3); // Triple 20 x3
    expect(segmentCount(sb, 1, 1)).toBe(1); // Single 1 x1
    expect(segmentCount(sb, 16, 1)).toBe(1); // Single 16 x1
    expect(segmentCount(sb, 20, 1)).toBe(0); // Single 20 never hit
  });

  it("tracks misses separately from scoring hits", () => {
    const throws = throwsOf(visit(d(0, 1), d(0, 1), d(20, 1)));
    const sb = segmentBreakdown(throws);
    expect(sb.misses).toBe(2);
    expect(segmentCount(sb, 20, 1)).toBe(1);
  });

  it("distinguishes outer bull (25) from bullseye (50)", () => {
    const throws = throwsOf(visit(d(25, 1), d(25, 2), d(25, 1)));
    const sb = segmentBreakdown(throws);
    expect(segmentCount(sb, 25, 1)).toBe(2); // outer bull
    expect(segmentCount(sb, 25, 2)).toBe(1); // bullseye
    expect(segmentCount(sb, 25, 3)).toBe(0); // no triple-bull ring
  });
});

describe("combineScoreTiers / combineSegmentCounts (cross-leg boundary safety)", () => {
  // Regression for a real bug (2026-08-23): a player who LOSES a leg doesn't necessarily throw a
  // multiple of 3 darts in it (their opponent may check out first, e.g. after the loser's own
  // last visit was only 2 darts). Concatenating that leg's throws with the next leg's BEFORE
  // chunking into 3-dart visits merges the tail of one leg with the head of the next into a
  // visit that was never thrown, corrupting the bucket near every leg boundary — this is exactly
  // how a real, confirmed 160 disappeared from a player's round-score distribution while still
  // correctly showing in their (independently-computed) lifetime highscore.
  const unevenLeg1 = throwsOf(visit(d(20, 3), d(19, 3))); // T20 T19 = 117, only 2 darts -> real tier "100+"
  const leg2Throws = throwsOf(visit(d(20, 2), d(5, 1), d(5, 1))); // D20 S5 S5 = 50, leg2's own real visit -> "40+"

  it("naive flatten-then-chunk loses leg1's real visit and fabricates a different one", () => {
    const broken = scoreTierBreakdown([...unevenLeg1, ...leg2Throws]);
    // leg1's real 117 ("100+") is gone: its 2 darts merged with leg2's first dart (D20) into a
    // fake T20 T19 D20 = 157 "visit" ("140+") that was never thrown.
    expect(broken.find((t) => t.label === "100+")!.count).toBe(0);
    expect(broken.find((t) => t.label === "140+")!.count).toBe(1);
  });

  it("combineScoreTiers recovers leg1's real visit and doesn't fabricate the seam visit", () => {
    const combined = combineScoreTiers([scoreTierBreakdown(unevenLeg1), scoreTierBreakdown(leg2Throws)]);
    expect(combined.find((t) => t.label === "100+")!.count).toBe(1); // leg1's real 117
    expect(combined.find((t) => t.label === "40+")!.count).toBe(1); // leg2's real 50
    expect(combined.find((t) => t.label === "140+")!.count).toBe(0); // no fabricated 157
  });

  it("combineScoreTiers sums matching tiers across legs and preserves every label", () => {
    const oneEighty = throwsOf(visit(d(20, 3), d(20, 3), d(20, 3)));
    const combined = combineScoreTiers([scoreTierBreakdown(oneEighty), scoreTierBreakdown(oneEighty)]);
    expect(combined.map((t) => t.label)).toEqual(["40+", "60+", "80+", "100+", "120+", "140+", "160+", "180"]);
    expect(combined.find((t) => t.label === "180")!.count).toBe(2);
  });

  it("combineScoreTiers on zero legs returns the full zeroed label set, not an empty array", () => {
    expect(combineScoreTiers([]).length).toBe(8);
  });

  it("combineSegmentCounts sums hits and misses across legs independently", () => {
    const legA = segmentBreakdown(throwsOf(visit(d(20, 3), d(0, 1), d(1, 1))));
    const legB = segmentBreakdown(throwsOf(visit(d(20, 3), d(1, 1), d(1, 1))));
    const combined = combineSegmentCounts([legA, legB]);
    expect(segmentCount(combined, 20, 3)).toBe(2);
    expect(segmentCount(combined, 1, 1)).toBe(3);
    expect(combined.misses).toBe(1);
  });
});

describe("combineStatBundles first9 (cross-leg boundary safety)", () => {
  // Regression (2026-09-01): first9 was recomputed via first9Average(overallThrows) — slicing the
  // first 9 elements off the flattened cross-leg array. Since legs are concatenated in play order,
  // that slice is always exactly leg 1's own first 9 darts, silently mislabeled as the whole
  // match's First 9 average — every other leg's real start was never looked at.
  const leg1Throws = throwsOf(visit(d(20, 1), d(20, 1), d(20, 1)), visit(d(20, 1), d(20, 1), d(20, 1)), visit(d(20, 1), d(20, 1), d(20, 1))); // 9 darts, all S20 -> first9 = 60
  const leg2Throws = throwsOf(visit(d(5, 1), d(5, 1), d(5, 1)), visit(d(5, 1), d(5, 1), d(5, 1))); // only 6 darts, all S5 -> first9 = 15 (a rate, unaffected by being a shorter leg)

  it("naive first9Average(overallThrows) returns only leg1's first9, ignoring leg2 entirely", () => {
    const overall = [...leg1Throws, ...leg2Throws];
    expect(first9Average(overall)).toBe(first9Average(leg1Throws)); // 60 — leg2's real 15 never seen
  });

  it("combineStatBundles averages each leg's own first9 instead", () => {
    const bundle1 = computeLegStatBundle(leg1Throws, 501, false);
    const bundle2 = computeLegStatBundle(leg2Throws, 501, false);
    const overall = combineStatBundles([bundle1, bundle2], [...leg1Throws, ...leg2Throws]);
    expect(bundle1.first9).toBe(60);
    expect(bundle2.first9).toBe(15);
    expect(overall.first9).toBe(37.5); // (60 + 15) / 2, not leg1's 60
  });

  it("excludes a leg the player never threw in, rather than averaging in a spurious 0", () => {
    const bundle1 = computeLegStatBundle(leg1Throws, 501, false);
    const neverThrew = computeLegStatBundle([], 501, false); // opponent finished before this player's turn
    const overall = combineStatBundles([bundle1, neverThrew], [...leg1Throws]);
    expect(overall.first9).toBe(60); // not (60 + 0) / 2 = 30
  });

  it("match average is a real dart-weighted total, unlike first9's unweighted per-leg mean", () => {
    const bundle1 = computeLegStatBundle(leg1Throws, 501, false);
    const bundle2 = computeLegStatBundle(leg2Throws, 501, false);
    const overall = combineStatBundles([bundle1, bundle2], [...leg1Throws, ...leg2Throws]);
    // Legs are different lengths (9 vs 6 darts), so these two intentionally diverge: average
    // weighs leg2's 6 darts less than leg1's 9 (42 = 210 total points / 15 darts * 3), while
    // first9 treats both legs' rates as equally-weighted data points (37.5 = (60+15)/2).
    expect(overall.average).toBe(42);
    expect(overall.first9).toBe(37.5);
  });
});
