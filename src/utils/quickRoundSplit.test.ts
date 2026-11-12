import { describe, it, expect } from "vitest";
import { splitVisitTotal } from "./quickRoundSplit";
import { isAchievableVisitTotal } from "./dartStats";
import { CHECKOUT_ROUTES } from "./checkoutTable";
import { resolveX01Visit } from "./x01Rules";

const sum = (darts: { points: number }[]) => darts.reduce((s, d) => s + d.points, 0);

describe("splitVisitTotal", () => {
  it("adds up to exactly the total for every achievable visit total", () => {
    for (let total = 0; total <= 180; total++) {
      const darts = splitVisitTotal(total);
      if (!isAchievableVisitTotal(total)) {
        expect(darts, `total ${total}`).toBeNull();
        continue;
      }
      expect(darts, `total ${total}`).not.toBeNull();
      expect(darts!.length).toBe(3);
      expect(sum(darts!), `total ${total}`).toBe(total);
      for (const d of darts!) expect(d.points).toBe(d.baseValue * d.multiplier);
    }
  });

  it("keeps the totals that used to be recorded wrong", () => {
    expect(sum(splitVisitTotal(170)!)).toBe(170);
    expect(sum(splitVisitTotal(164)!)).toBe(164);
    expect(sum(splitVisitTotal(143)!)).toBe(143);
    expect(sum(splitVisitTotal(125)!)).toBe(125);
  });

  it("splits 180 into three treble 20s", () => {
    expect(splitVisitTotal(180)).toEqual([
      { baseValue: 20, multiplier: 3, points: 60 },
      { baseValue: 20, multiplier: 3, points: 60 },
      { baseValue: 20, multiplier: 3, points: 60 },
    ]);
  });

  it("ends every double-out finish on a double, so it counts as a checkout", () => {
    for (const key of Object.keys(CHECKOUT_ROUTES)) {
      const remaining = Number(key);
      const darts = splitVisitTotal(remaining, { remaining, doubleOut: true })!;
      expect(sum(darts), `finish ${remaining}`).toBe(remaining);
      expect(darts[darts.length - 1].multiplier, `finish ${remaining}`).toBe(2);
      const outcome = resolveX01Visit(remaining, true, darts.map((d) => ({ points: d.points, isDouble: d.multiplier === 2 })));
      expect(outcome.kind === "checkout" || outcome.kind === "ambiguous", `finish ${remaining}`).toBe(true);
    }
  });

  it("does not use the finish route when the total leaves a score", () => {
    const darts = splitVisitTotal(40, { remaining: 100, doubleOut: true })!;
    expect(darts.length).toBe(3);
    expect(sum(darts)).toBe(40);
  });

  it("contains a double when double-in is still open", () => {
    for (const total of [40, 60, 100, 26, 45, 140]) {
      const darts = splitVisitTotal(total, { needsDouble: true })!;
      expect(sum(darts), `total ${total}`).toBe(total);
      expect(darts.some((d) => d.multiplier === 2), `total ${total}`).toBe(true);
    }
  });

  it("rejects totals outside 0-180 and non-integers", () => {
    expect(splitVisitTotal(-1)).toBeNull();
    expect(splitVisitTotal(181)).toBeNull();
    expect(splitVisitTotal(12.5)).toBeNull();
  });
});
