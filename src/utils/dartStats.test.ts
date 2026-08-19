import { describe, it, expect } from "vitest";
import { isAchievableVisitTotal } from "./dartStats";

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
