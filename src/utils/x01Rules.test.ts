import { describe, it, expect } from "vitest";
import { isBustThrow, isQualifyingDouble, resolveX01Visit, type VisitDart } from "./x01Rules";

describe("isQualifyingDouble", () => {
  it("is true only for multiplier 2 (includes bullseye)", () => {
    expect(isQualifyingDouble(2)).toBe(true);
    expect(isQualifyingDouble(1)).toBe(false);
    expect(isQualifyingDouble(3)).toBe(false);
  });
});

describe("isBustThrow", () => {
  it("busts on going below zero, double-out or not", () => {
    expect(isBustThrow(20, 25, true, false)).toBe(true);
    expect(isBustThrow(20, 25, false, false)).toBe(true);
  });

  it("landing on exactly 1 busts under double-out", () => {
    expect(isBustThrow(21, 20, true, false)).toBe(true);
  });

  it("landing on exactly 1 is legal under single-out", () => {
    expect(isBustThrow(21, 20, false, false)).toBe(false);
  });

  it("checking out without a double busts under double-out", () => {
    expect(isBustThrow(20, 20, true, false)).toBe(true);
  });

  it("checking out on a qualifying double is never a bust", () => {
    expect(isBustThrow(20, 20, true, true)).toBe(false);
  });

  it("checking out without a double is fine under single-out", () => {
    expect(isBustThrow(20, 20, false, false)).toBe(false);
  });

  it("a normal scoring dart that doesn't finish is never a bust", () => {
    expect(isBustThrow(100, 60, true, false)).toBe(false);
    expect(isBustThrow(100, 60, false, false)).toBe(false);
  });
});

describe("resolveX01Visit — order-independent camera-round resolution", () => {
  const d = (points: number, isDouble = false): VisitDart => ({ points, isDouble });

  it("continues when the visit total falls short of remaining, regardless of order", () => {
    expect(resolveX01Visit(170, true, [d(60), d(40)])).toEqual({ kind: "continue" });
  });

  it("busts on overshoot no matter which dart in the array would be 'last'", () => {
    expect(resolveX01Visit(100, true, [d(60), d(60)])).toEqual({ kind: "bust" });
    // Same total, darts listed in the opposite (still arbitrary) order — same outcome.
    expect(resolveX01Visit(100, true, [d(60, false), d(60, false)])).toEqual({ kind: "bust" });
  });

  it("busts on landing exactly on 1 under double-out, regardless of which dart did it", () => {
    // remaining 21, visit totals 20 (e.g. T5+S5), leaving exactly 1 — always a bust under
    // double-out, independent of any dart's own double-ness.
    expect(resolveX01Visit(21, true, [d(15), d(5, true)])).toEqual({ kind: "bust" });
  });

  it("landing on exactly 1 is fine under single-out — just continues", () => {
    expect(resolveX01Visit(21, false, [d(15), d(5)])).toEqual({ kind: "continue" });
  });

  it("single-out: hitting remaining exactly is always a checkout, no double needed", () => {
    expect(resolveX01Visit(60, false, [d(60, false)])).toEqual({ kind: "checkout" });
  });

  it("double-out: a lone finishing double is an unambiguous checkout", () => {
    expect(resolveX01Visit(40, true, [d(40, true)])).toEqual({ kind: "checkout" });
  });

  it("double-out: every dart in the visit being a double is an unambiguous checkout, whichever was actually last", () => {
    // e.g. D20, D20 finishing from 80 — no non-double exists to have possibly been thrown last.
    expect(resolveX01Visit(80, true, [d(40, true), d(40, true)])).toEqual({ kind: "checkout" });
  });

  it("double-out: hitting remaining exactly with zero doubles in the visit is an unambiguous bust", () => {
    // T20 (triple, not a double) landing exactly on remaining can never legally finish.
    expect(resolveX01Visit(60, true, [d(60, false)])).toEqual({ kind: "bust" });
  });

  it("double-out: a genuine mix of one double and non-doubles summing to remaining is ambiguous", () => {
    // S20, S20, D20 (80 total): a real order could be [S20,S20,D20] (valid checkout, double
    // last) or [D20,S20,S20] (bust — the double was thrown first, a single lands on exactly 0
    // last). Nothing in the unordered set can tell these apart.
    const result = resolveX01Visit(80, true, [d(20), d(20), d(40, true)]);
    expect(result).toEqual({ kind: "ambiguous", doubleIndexes: [2] });
  });

  it("double-out: a mix stays ambiguous even with multiple doubles present, since a non-double could still have been last", () => {
    // D20, S20, D20 (100 total): [S20 last] busts (a single landing on exactly 0) just as
    // validly as [either D20 last] checks out — more doubles doesn't remove the ambiguity.
    const result = resolveX01Visit(100, true, [d(40, true), d(20), d(40, true)]);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") expect(result.doubleIndexes).toEqual([0, 2]);
  });
});
