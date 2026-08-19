import { describe, it, expect } from "vitest";
import { configForAverage } from "./botPlayer";

describe("configForAverage", () => {
  it("picks progressively more accurate configs as the target average rises", () => {
    // Each step up should never be a LESS accurate bot than the step before it — the whole
    // point is a monotonic skill ladder from "easy" up through "legendary".
    const tiers = [10, 40, 60, 100, 150].map((avg) => configForAverage(avg));
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].miss).toBeLessThanOrEqual(tiers[i - 1].miss);
      expect(tiers[i].doubleHitChance).toBeGreaterThanOrEqual(tiers[i - 1].doubleHitChance);
    }
  });

  it("reaches the top tier for a nine-darter-level average (~167/round)", () => {
    const cfg = configForAverage(167);
    expect(cfg.miss).toBeLessThan(0.05);
    expect(cfg.doubleHitChance).toBeGreaterThan(0.7);
  });
});
