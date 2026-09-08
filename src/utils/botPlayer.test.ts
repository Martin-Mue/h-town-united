import { describe, it, expect } from "vitest";
import { configForAverage, rollConfigForLevel, simulateBotVisit, BOT_LEVEL_RANGES } from "./botPlayer";

/** Every dart in a visit started this far from finishing always aims at T20 (see
 *  simulateBotVisit's own `rem <= 170` branching) — the same "huge remaining score" trick the
 *  file's own MEASURED-averages comment describes, so a visit's darts are a clean, uncontaminated
 *  sample of simulateDart's aimed-triple branch specifically. */
const HUGE_REMAINING = 100000;

/** Fraction of darts across many visits at `level` that scored exactly 0 — the genuine complete
 *  misses, as opposed to a near-miss single that still landed on the board. */
function zeroDartRate(level: "easy" | "elite" | "legendary", visits = 4000): number {
  let zero = 0, total = 0;
  for (let i = 0; i < visits; i++) {
    const { darts } = simulateBotVisit(HUGE_REMAINING, true, level);
    for (const d of darts) { total++; if (d.points === 0) zero++; }
  }
  return zero / total;
}

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

describe("elite/legendary miss realism (Round 3 Rang 11)", () => {
  it("still lets easy whiff completely at its full, undiluted miss rate", () => {
    // easy has no missNeighborChance at all — this is the pre-Rang-11 control case, confirming
    // the harness itself reads a believable rate before trusting it on elite/legendary below.
    const rate = zeroDartRate("easy");
    expect(rate).toBeGreaterThan(0.25);
    expect(rate).toBeLessThan(0.35);
  });

  it("elite and legendary complete-miss far less often than their raw `miss` probability, because most of it now lands on a neighboring single instead of scoring zero", () => {
    // Elite/legendary's tuned miss fields (0.121 / 0.094) are themselves HIGHER than their
    // pre-Rang-11 values (0.105 / 0.075) — see LEVEL_CONFIG's own doc comment — precisely because
    // most of that probability mass no longer means a true zero. The genuinely-scores-zero rate
    // should come out well below both the old AND new raw miss numbers.
    const eliteRate = zeroDartRate("elite");
    const legendaryRate = zeroDartRate("legendary");
    expect(eliteRate).toBeGreaterThan(0);
    expect(eliteRate).toBeLessThan(0.09);
    expect(legendaryRate).toBeGreaterThan(0);
    expect(legendaryRate).toBeLessThan(0.06);
    // A sharper bot should still whiff the board outright less often than a merely-elite one.
    expect(legendaryRate).toBeLessThan(eliteRate);
  });

  it("keeps elite/legendary's own measured 3-dart average close to its documented anchor despite the miss-model change", () => {
    // The whole point of retuning `miss`/`aimedTriple` alongside missNeighborChance was to hold
    // the ladder's documented averages (~71 elite, ~89 legendary) steady — this is a regression
    // guard against that retuning drifting apart from the realism change in a future edit.
    function threeDartAverage(level: "elite" | "legendary", visits: number): number {
      let points = 0, darts = 0;
      for (let i = 0; i < visits; i++) {
        const res = simulateBotVisit(HUGE_REMAINING, true, level);
        for (const d of res.darts) { points += d.points; darts++; }
      }
      return (points / darts) * 3;
    }
    expect(threeDartAverage("elite", 4000)).toBeGreaterThan(67);
    expect(threeDartAverage("elite", 4000)).toBeLessThan(75);
    expect(threeDartAverage("legendary", 4000)).toBeGreaterThan(85);
    expect(threeDartAverage("legendary", 4000)).toBeLessThan(94);
  });
});
