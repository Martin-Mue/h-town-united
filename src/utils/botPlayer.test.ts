import { describe, it, expect } from "vitest";
import { configForAverage, rollConfigForLevel, simulateBotVisit, BOT_LEVEL_RANGES } from "./botPlayer";

/** Every dart in a visit started this far from finishing always aims at T20 (see
 *  simulateBotVisit's own `rem <= 170` branching) — the same "huge remaining score" trick the
 *  file's own MEASURED-averages comment describes, so a visit's darts are a clean, uncontaminated
 *  sample of simulateDart's aimed-triple branch specifically. */
const HUGE_REMAINING = 100000;

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

  it("aims more tightly the higher the target average, and stops tightening beyond the top of the table", () => {
    expect(configForAverage(40).aimSigmaMm!).toBeGreaterThan(configForAverage(60).aimSigmaMm!);
    expect(configForAverage(60).aimSigmaMm!).toBeGreaterThan(configForAverage(90).aimSigmaMm!);
    expect(configForAverage(300).aimSigmaMm).toEqual(configForAverage(200).aimSigmaMm);
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
        const rolled = rollConfigForLevel(level).config;
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
    const rolls = Array.from({ length: 40 }, () => rollConfigForLevel("legendary").config);
    const weakest = configForAverage(min);
    const sharpest = configForAverage(max);
    const span = weakest.miss - sharpest.miss;
    // At least one roll out of 40 should land in the sharper half of the range (miss closer to
    // the top end than the middle) — near-certain if rolls truly spread across the full range,
    // essentially impossible (~1 in a trillion) if they were all silently clamping to the center.
    expect(rolls.some((r) => r.miss < sharpest.miss + span * 0.5)).toBe(true);
  });
});

/** Real 3-dart average over whole legs of 501 double out (checkout play and busts included). */
function fullLegAverage(avg: number, legs: number): number {
  const cfg = configForAverage(avg);
  let points = 0, darts = 0;
  for (let leg = 0; leg < legs; leg++) {
    let rem = 501;
    for (let visit = 0; visit < 200 && rem > 0; visit++) {
      const res = simulateBotVisit(rem, true, cfg);
      darts += res.darts.length;
      if (res.bustedOnDartIndex !== null) continue;
      const scored = res.darts.reduce((sum, d) => sum + d.points, 0);
      points += scored;
      rem -= scored;
    }
  }
  return (points / darts) * 3;
}

describe("aimed throws (2026-11-25)", () => {
  it("each level's middle plays close to that average over whole legs", () => {
    for (const level of Object.keys(BOT_LEVEL_RANGES) as (keyof typeof BOT_LEVEL_RANGES)[]) {
      const [min, max] = BOT_LEVEL_RANGES[level];
      const middle = (min + max) / 2;
      const real = fullLegAverage(middle, 400);
      expect(real, level).toBeGreaterThan(middle - 4);
      expect(real, level).toBeLessThan(middle + 4);
    }
  });

  it("a dart aimed at T20 that misses lands around it (20, 1, 5), not anywhere on the board", () => {
    let near = 0, total = 0;
    for (let i = 0; i < 3000; i++) {
      for (const d of simulateBotVisit(HUGE_REMAINING, true, configForAverage(55)).darts) {
        total++;
        if (d.baseValue === 20 || d.baseValue === 1 || d.baseValue === 5) near++;
      }
    }
    expect(near / total).toBeGreaterThan(0.8);
  });

  it("every bot dart carries where it landed, so the drawn board shows it there", () => {
    const { darts } = simulateBotVisit(HUGE_REMAINING, true, "medium");
    for (const d of darts) {
      expect(typeof d.boardU).toBe("number");
      expect(typeof d.boardV).toBe("number");
    }
  });
});

describe("simulateBotVisit finishes legally under every out rule", () => {
  const rules = ["single", "double", "master"] as const;
  const mayFinish = (multiplier: number, rule: (typeof rules)[number]) =>
    rule === "single" || multiplier === 2 || (rule === "master" && multiplier === 3);

  it("a checkout ends on a legal last dart and adds up to the score; a visit never leaves 1 under double or master out", () => {
    for (const rule of rules) {
      for (const remaining of [2, 3, 20, 32, 40, 57, 60, 61, 100, 120, 159, 170, 180]) {
        for (let run = 0; run < 150; run++) {
          const res = simulateBotVisit(remaining, rule, "legendary");
          const scored = res.darts.reduce((s, d) => s + d.points, 0);
          if (res.checkedOut) {
            expect(scored, `${rule} ${remaining}`).toBe(remaining);
            expect(mayFinish(res.darts[res.darts.length - 1].multiplier, rule), `${rule} ${remaining}`).toBe(true);
          } else if (res.bustedOnDartIndex === null) {
            expect(remaining - scored, `${rule} ${remaining}`).toBeGreaterThanOrEqual(rule === "single" ? 1 : 2);
          }
        }
      }
    }
  });

  it("master out: can finish 60 with one treble and 180 with three, which double out cannot", () => {
    let trebleFinish = false;
    let maximumFinish = false;
    for (let run = 0; run < 3000 && !(trebleFinish && maximumFinish); run++) {
      const sixty = simulateBotVisit(60, "master", "legendary");
      if (sixty.checkedOut && sixty.darts.length === 1 && sixty.darts[0].multiplier === 3) trebleFinish = true;
      if (simulateBotVisit(180, "master", "legendary").checkedOut) maximumFinish = true;
    }
    expect(trebleFinish).toBe(true);
    expect(maximumFinish).toBe(true);
    for (let run = 0; run < 300; run++) expect(simulateBotVisit(180, "double", "legendary").checkedOut).toBe(false);
  });

  it("still takes the old boolean: true is double out, false is single out", () => {
    for (let run = 0; run < 300; run++) {
      const res = simulateBotVisit(60, true, "legendary");
      if (res.checkedOut) expect(res.darts[res.darts.length - 1].multiplier).toBe(2);
    }
  });
});
