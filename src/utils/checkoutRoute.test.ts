import { describe, it, expect } from "vitest";
import { checkoutAdvice, bestDouble } from "./checkoutRoute";
import { CHECKOUT_ROUTES } from "./checkoutTable";

const points = (label: string) => (label === "Bull" ? 50 : Number(label.slice(1)) * (label[0] === "T" ? 3 : label[0] === "D" ? 2 : 1));
const total = (darts: string[]) => darts.reduce((s, d) => s + points(d), 0);
const endsOnDouble = (darts: string[]) => darts[darts.length - 1].startsWith("D") || darts[darts.length - 1] === "Bull";

describe("checkoutAdvice", () => {
  it("gives the table route with three darts in hand", () => {
    expect(checkoutAdvice(170)).toEqual({ darts: ["T20", "T20", "Bull"] });
    expect(checkoutAdvice(100)).toEqual({ darts: ["T20", "D20"] });
  });

  it("never suggests more darts than are in the hand, and every finish adds up and ends on a double", () => {
    for (const key of Object.keys(CHECKOUT_ROUTES)) {
      const remaining = Number(key);
      for (const dartsLeft of [1, 2, 3]) {
        const advice = checkoutAdvice(remaining, { dartsLeft });
        if (!advice) continue;
        expect(advice.darts.length, `${remaining} with ${dartsLeft}`).toBeLessThanOrEqual(dartsLeft);
        if (advice.leaves === undefined) {
          expect(total(advice.darts), `${remaining} with ${dartsLeft}`).toBe(remaining);
          expect(endsOnDouble(advice.darts), `${remaining} with ${dartsLeft}`).toBe(true);
        } else {
          expect(remaining - total(advice.darts)).toBe(advice.leaves);
          expect(advice.leaves).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("finds a two-dart finish where the table needs three", () => {
    // 101 is T20 S1 D20 in the table; with two darts it is T17 Bull
    const advice = checkoutAdvice(101, { dartsLeft: 2 })!;
    expect(advice.leaves).toBeUndefined();
    expect(advice.darts.length).toBe(2);
    expect(total(advice.darts)).toBe(101);
  });

  it("suggests a set-up shot with the last dart when no finish is left", () => {
    expect(checkoutAdvice(100, { dartsLeft: 1 })).toEqual({ darts: ["T20"], leaves: 40 });
    expect(checkoutAdvice(57, { dartsLeft: 1 })).toEqual({ darts: ["S17"], leaves: 40 });
  });

  it("says nothing with two darts and no finish (the player just scores)", () => {
    expect(checkoutAdvice(170, { dartsLeft: 2 })).toBeNull();
  });

  it("ends on the player's best double when a single makes it possible", () => {
    expect(checkoutAdvice(52, { preferredDouble: "D16" })).toEqual({ darts: ["S20", "D16"] });
    // no single leaves D16 from 100, so the usual route stays
    expect(checkoutAdvice(100, { preferredDouble: "D16" })).toEqual({ darts: ["T20", "D20"] });
    expect(checkoutAdvice(100, { dartsLeft: 1, preferredDouble: "D16" })).toEqual({ darts: ["T20"], leaves: 40 });
    expect(checkoutAdvice(52, { dartsLeft: 1, preferredDouble: "D16" })).toEqual({ darts: ["S20"], leaves: 32 });
  });

  it("returns null below 2 and for scores out of reach", () => {
    expect(checkoutAdvice(1)).toBeNull();
    expect(checkoutAdvice(0)).toBeNull();
    expect(checkoutAdvice(301)).toBeNull();
    expect(checkoutAdvice(250, { dartsLeft: 1 })).toBeNull();
  });
});

describe("bestDouble", () => {
  it("picks the double with the best rate among those tried often enough", () => {
    const record = [
      { label: "D20", stats: { attempts: 30, percentage: 22 } },
      { label: "D16", stats: { attempts: 12, percentage: 35 } },
      { label: "D8", stats: { attempts: 2, percentage: 100 } },
    ];
    expect(bestDouble(record)).toBe("D16");
  });
  it("is null without enough attempts", () => {
    expect(bestDouble([{ label: "D8", stats: { attempts: 2, percentage: 100 } }])).toBeNull();
    expect(bestDouble(null)).toBeNull();
  });
});
