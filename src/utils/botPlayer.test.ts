import { describe, it, expect } from "vitest";
import { configForAverage, rollConfigForLevel, BOT_LEVEL_RANGES } from "./botPlayer";

describe("configForAverage", () => {
  it("picks progressively more accurate configs as the target average rises", () => {
    // Each step up should never be a LESS accurate bot than the step before it — the whole
    // point is a monotonic skill ladder from "easy" up through "legendary", continuously
    // interpolated now rather than snapped to one of five fixed tiers.
    const tiers = [10, 40, 55, 70, 90].map((avg) => configForAverage(avg));
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].miss).toBeLessThanOrEqual(tiers[i - 1].miss);
      expect(tiers[i].doubleHitChance).toBeGreaterThanOrEqual(tiers[i - 1].doubleHitChance);
    }
  });

  it("clamps to the top anchor once the target exceeds what any bot offers", () => {
    // The ladder deliberately tops out well below nine-dart-leg pace now (nobody needs a club
    // bot that strong) — a target far beyond the top anchor just gets the top anchor's config,
    // same as one right at it, rather than anything sharper.
    expect(configForAverage(300)).toEqual(configForAverage(101));
  });
});

describe("rollConfigForLevel", () => {
  it("never rolls a config sharper than the top, or weaker than the bottom, of the level's own declared range", () => {
    // Can't inspect the random target directly, but every field the roll can produce is itself
    // monotonic in configForAverage, so bounding by the range's own two endpoints is exact.
    for (const level of Object.keys(BOT_LEVEL_RANGES) as (keyof typeof BOT_LEVEL_RANGES)[]) {
      const [min, max] = BOT_LEVEL_RANGES[level];
      const weakest = configForAverage(min);
      const sharpest = configForAverage(max);
      for (let i = 0; i < 30; i++) {
        const rolled = rollConfigForLevel(level);
        expect(rolled.miss).toBeLessThanOrEqual(weakest.miss);
        expect(rolled.miss).toBeGreaterThanOrEqual(sharpest.miss);
        expect(rolled.doubleHitChance).toBeGreaterThanOrEqual(weakest.doubleHitChance);
        expect(rolled.doubleHitChance).toBeLessThanOrEqual(sharpest.doubleHitChance);
      }
    }
  });

  it("covers the full width of a range across many rolls, not just its center", () => {
    // Regression guard for the "clamps to the center anchor" bug this exact case hit once
    // already (legendary's 80-100 range collapsing to ~89 for anything above it, before
    // LEGENDARY_CEILING was added as a real interpolation target for the top half).
    const [min, max] = BOT_LEVEL_RANGES.legendary;
    const rolls = Array.from({ length: 40 }, () => rollConfigForLevel("legendary"));
    const weakest = configForAverage(min);
    const sharpest = configForAverage(max);
    const span = weakest.miss - sharpest.miss;
    // At least one roll out of 40 should land in the sharper half of the range (miss closer to
    // the top end than the middle) — near-certain if rolls truly spread across the full range,
    // essentially impossible (~1 in a trillion) if they were all silently clamping to the center.
    expect(rolls.some((r) => r.miss < sharpest.miss + span * 0.5)).toBe(true);
  });
});
