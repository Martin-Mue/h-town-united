import { describe, it, expect } from "vitest";
import type { DartThrow } from "./dartStats";
import { scoringPhaseTotals, combineScoringPhaseTotals, averageToCheckoutRange } from "./averageToCheckoutRange";

const dart = (baseValue: number, multiplier: number): DartThrow => ({ baseValue, multiplier, points: baseValue * multiplier });
const t20 = dart(20, 3);

describe("scoringPhaseTotals", () => {
  it("counts only visits that started above 170, including the one that crosses into range", () => {
    // 501 -> 321 -> 141 (this visit started on 321, counts) -> next visit starts on 141, excluded
    const throws = [t20, t20, t20, t20, t20, t20, dart(20, 1), dart(20, 1), dart(20, 1)];
    expect(scoringPhaseTotals(throws, 501)).toEqual({ points: 360, darts: 6 });
  });

  it("includes the visit that lands exactly on 171 and the next one, which starts above 170", () => {
    // 501 - 180 - 150 = 171 -> still above 170, so the third visit counts too
    const throws = [t20, t20, t20, t20, t20, dart(10, 3), dart(1, 1), dart(1, 1), dart(1, 1)];
    expect(scoringPhaseTotals(throws, 501)).toEqual({ points: 180 + 150 + 3, darts: 9 });
  });

  it("returns nothing for a leg that never leaves checkout range", () => {
    expect(scoringPhaseTotals([dart(20, 2), dart(20, 1)], 170)).toEqual({ points: 0, darts: 0 });
    expect(scoringPhaseTotals([dart(20, 3), dart(19, 3), dart(2, 2)], 101)).toEqual({ points: 0, darts: 0 });
  });

  it("handles a leg with no throws at all", () => {
    expect(scoringPhaseTotals([], 501)).toEqual({ points: 0, darts: 0 });
  });

  it("excludes a checkout in 1, 2 or 3 darts because it starts inside the range", () => {
    // 501 -> 141 after two max visits, then a finish of 50 / 70 / 141 in 1 / 2 / 3 darts is all
    // thrown from inside the range
    const opener = [t20, t20, t20, t20, t20, t20];
    const finishes = [[dart(25, 2)], [dart(20, 1), dart(25, 2)], [t20, dart(19, 3), dart(12, 2)]];
    for (const finish of finishes) {
      expect(scoringPhaseTotals([...opener, ...finish], 501)).toEqual({ points: 360, darts: 6 });
    }
  });

  it("works for a 301 leg whose first visit already starts in range after a big opener", () => {
    // 301 -> 121 after one 180 visit; the first visit started above 170, the second does not
    expect(scoringPhaseTotals([t20, t20, t20, dart(20, 1), dart(1, 1), dart(0, 1)], 301)).toEqual({ points: 180, darts: 3 });
  });

  it("uses the handicap starting score it is given", () => {
    expect(scoringPhaseTotals([dart(20, 1), dart(20, 1), dart(20, 1)], 170)).toEqual({ points: 0, darts: 0 });
    expect(scoringPhaseTotals([dart(20, 1), dart(20, 1), dart(20, 1)], 231)).toEqual({ points: 60, darts: 3 });
  });

  it("ignores hole placeholders for points and darts", () => {
    const hole: DartThrow = { baseValue: -1, multiplier: 1, points: 0 };
    expect(scoringPhaseTotals([t20, hole, t20], 501)).toEqual({ points: 120, darts: 2 });
  });

  it("counts a partial last visit by its real dart count", () => {
    expect(scoringPhaseTotals([t20, dart(20, 1)], 501)).toEqual({ points: 80, darts: 2 });
  });
});

describe("averageToCheckoutRange", () => {
  it("is points per dart times three", () => {
    expect(averageToCheckoutRange({ points: 360, darts: 6 })).toBe(180);
    expect(averageToCheckoutRange({ points: 100, darts: 3 })).toBe(100);
  });

  it("is null, not 0, when there was no scoring phase", () => {
    expect(averageToCheckoutRange({ points: 0, darts: 0 })).toBeNull();
  });

  it("keeps a genuine 0 average distinct from no data", () => {
    expect(averageToCheckoutRange({ points: 0, darts: 3 })).toBe(0);
  });
});

describe("combineScoringPhaseTotals", () => {
  it("pools points and darts across legs instead of averaging the averages", () => {
    const combined = combineScoringPhaseTotals([{ points: 300, darts: 6 }, { points: 60, darts: 3 }]);
    expect(combined).toEqual({ points: 360, darts: 9 });
    expect(averageToCheckoutRange(combined)).toBe(120);
  });

  it("is empty for no legs", () => {
    expect(combineScoringPhaseTotals([])).toEqual({ points: 0, darts: 0 });
  });
});
