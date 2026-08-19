import { describe, it, expect } from "vitest";
import { ghostRemainingSequence, compareToGhost, buildBenchmarkSequence } from "./ghostMode";
import type { DartThrow } from "@/types/game";

const dart = (points: number): DartThrow => ({ baseValue: points, multiplier: 1, points });

describe("ghostRemainingSequence", () => {
  it("tracks running remaining after each dart, starting from the first", () => {
    const seq = ghostRemainingSequence([dart(60), dart(60), dart(45)], 501);
    expect(seq).toEqual([441, 381, 336]);
  });

  it("returns an empty sequence for a leg with no throws", () => {
    expect(ghostRemainingSequence([], 501)).toEqual([]);
  });
});

describe("compareToGhost", () => {
  const ghost = ghostRemainingSequence([dart(60), dart(60), dart(60), dart(60), dart(60), dart(60)], 501); // 141 after 6 darts

  it("reports ahead (positive) when scoring more than the ghost had at the same dart count", () => {
    // After 3 darts I'm at 321 (thrown 180 total); ghost was at 321 too at that point... let's
    // make it concrete: I threw 200 in 3 darts (remaining 301), ghost was at 321 after 3 darts.
    const result = compareToGhost(3, 301, ghost);
    expect(result).not.toBeNull();
    expect(result!.ghostRemaining).toBe(321);
    expect(result!.aheadBy).toBe(20); // 321 - 301: I'm 20 points further along
  });

  it("reports behind (negative) when scoring less than the ghost at the same dart count", () => {
    const result = compareToGhost(3, 350, ghost); // I only got to 350, ghost was at 321
    expect(result!.aheadBy).toBe(-29);
  });

  it("treats the ghost as already finished (remaining 0) once its own leg was shorter", () => {
    // Ghost's recorded leg only has 6 darts; asking about dart 9 must not read past the array.
    const result = compareToGhost(9, 50, ghost);
    expect(result!.ghostRemaining).toBe(0);
    expect(result!.aheadBy).toBe(-50); // still 50 remaining myself while the ghost had already finished
  });

  it("returns null before any dart has been thrown or with no ghost data", () => {
    expect(compareToGhost(0, 501, ghost)).toBeNull();
    expect(compareToGhost(3, 301, [])).toBeNull();
  });
});

describe("buildBenchmarkSequence", () => {
  it("lands on exactly 0 at the final dart, for any start score / dart count", () => {
    expect(buildBenchmarkSequence(501, 9)[8]).toBe(0);
    expect(buildBenchmarkSequence(301, 15)[14]).toBe(0);
  });

  it("returns the right number of entries and decreases monotonically", () => {
    const seq = buildBenchmarkSequence(501, 12);
    expect(seq).toHaveLength(12);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThan(seq[i - 1]);
  });

  it("paces a 501/9 benchmark close to the real classic 9-darter shape (~60/dart)", () => {
    const seq = buildBenchmarkSequence(501, 9);
    expect(seq[0]).toBeCloseTo(501 - 501 / 9, 0); // ~445, i.e. roughly a 56-avg opening dart
  });
});
