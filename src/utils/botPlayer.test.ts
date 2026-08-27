import { describe, it, expect } from "vitest";
import { configForAverage } from "./botPlayer";

describe("configForAverage", () => {
  it("picks progressively more accurate configs as the target average rises", () => {
    // Each step up should never be a LESS accurate bot than the step before it — the whole
    // point is a monotonic skill ladder from "easy" up through "legendary". One sample per
    // tier (thresholds are 37/50/64/79) so this actually exercises all five, not just the ends.
    const tiers = [10, 40, 55, 70, 90].map((avg) => configForAverage(avg));
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].miss).toBeLessThanOrEqual(tiers[i - 1].miss);
      expect(tiers[i].doubleHitChance).toBeGreaterThanOrEqual(tiers[i - 1].doubleHitChance);
    }
  });

  it("clamps to the top tier once the target exceeds what any bot offers", () => {
    // The ladder deliberately tops out well below nine-dart-leg pace now (nobody needs a club
    // bot that strong) — a target far beyond the top tier just gets the top tier, same as one
    // right at its own threshold, rather than anything sharper.
    expect(configForAverage(300)).toEqual(configForAverage(90));
  });
});
