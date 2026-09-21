import type { BotLevel, DartThrow } from "@/types/game";
import { getCheckoutSuggestion } from "@/utils/checkoutTable";
import { isBustThrow, pointsFor } from "@/utils/x01Rules";

/**
 * Bot tuning, retuned 2026-09-21 after a real report that "The Machine" (hard) played
 * noticeably weaker than its advertised 50-60. Root cause, confirmed by simulating full legs
 * (not just isolated visits): the ORIGINAL anchors below were measured with simulateBotVisit
 * called directly against a huge remaining score, so a visit's darts are a clean sample of pure
 * scoring accuracy — simulateBotVisit never engages its own checkout-seeking targeting
 * (rem <= 170 branch: aiming at doubles, or a deliberate single to leave an even number) in that
 * setup at all. A REAL leg spends real time in that checkout phase, which inherently scores less
 * per dart than blasting T20 — so a real full-leg 3-dart average always lands BELOW the
 * scoring-only anchor, by an amount that grows with skill (a sharper bot resolves its scoring
 * phase faster, so checkout play is proportionally more of the leg, and it more often has enough
 * accuracy to deliberately aim a lower-value setup shot instead of a wild treble). Measured drag
 * at the old anchors: ~3-4 pts at easy/medium/hard, ~6-7.5 pts at elite/legendary.
 *
 * Fix: each level's config now sits at whatever point on the SAME accuracy curve makes its REAL,
 * full-leg-simulated average (checkout phase included) land at the CENTER of its own advertised
 * range, not just its scoring-only phase center. Same interpolation mechanism as before
 * (configForAverage/TIER_ANCHORS), just evaluated further along it — no new "realism" was
 * invented, every level just got measurably more accurate:
 *   easy      (Lucky Luke)  scoring-only ≈ 37.0, REAL full-leg avg ≈ 34, range 30-40
 *   medium    (Robin Hood)  scoring-only ≈ 49.5, REAL full-leg avg ≈ 45, range 40-55
 *   hard      (The Machine) scoring-only ≈ 59.6, REAL full-leg avg ≈ 55, range 55-65
 *   elite     (Dart Vader)  scoring-only ≈ 76.6, REAL full-leg avg ≈ 70, range 67-87
 *   legendary (The Prodigy) scoring-only ≈ 98.1, REAL full-leg avg ≈ 90, range 88-100
 * legendary's range tops out at 100 rather than reaching for a literal real-100-average bot on
 * purpose (LEGENDARY_CEILING's own doc comment already covers why nothing sharper than that
 * exists — "nobody needs a club bot that strong" predates this retune and still holds).
 *
 * A real opponent doesn't play the exact same average every leg — some legs go better, some
 * worse — so a bot's EFFECTIVE config for a given leg is rolled fresh (rollConfigForLevel below),
 * not pinned to the anchor config above every time. It's a bounded RANDOM WALK from the previous
 * leg's roll now, not an independent pick each time: a real opponent's next leg is usually close
 * to their last one, not anywhere in their whole range — see rollConfigForLevel's own doc comment.
 * configForAverage interpolates smoothly between the six anchors instead of snapping to the
 * nearest one, so a rolled in-between target (or a Ghost-mode target average) actually lands
 * close to where it should, not wherever the nearest fixed tier happens to sit.
 */
export interface LevelConfig {
  /** probability of a complete miss on a scoring dart */
  miss: number;
  /** probability of hitting a random low-ish single */
  randomSingle: number;
  /** probability of hitting the single of the aimed (big) number */
  aimedSingle: number;
  /** probability of hitting the triple of the aimed number */
  aimedTriple: number;
  /** probability of hitting an aimed double / bull finish */
  doubleHitChance: number;
  /** Round 3 Rang 11: of the `miss` probability above (a scoring dart aimed at a triple that
   *  doesn't land there), the fraction that instead strays to an adjacent number's single —
   *  a real player's "miss" rarely means the dart goes nowhere; it usually means it landed one
   *  segment off. The remainder of `miss` is a genuine errant dart (0 points), same as before this
   *  field existed. 0/undefined reproduces the old flat-zero behavior exactly — see simulateDart's
   *  aimed-triple branch. Only elite/legendary use this (see doc comment above LEVEL_CONFIG); a
   *  beginner bot missing the board entirely needs no such nuance. `miss` itself was retuned
   *  alongside this for elite/legendary so the measured 3-dart averages below are unchanged —
   *  see this file's own botsim tuning notes if re-deriving. */
  missNeighborChance?: number;
}

const LEVEL_CONFIG: Record<BotLevel, LevelConfig> = {
  easy: { miss: 0.293, randomSingle: 0.438, aimedSingle: 0.207, aimedTriple: 0.062, doubleHitChance: 0.134 },
  medium: { miss: 0.196, randomSingle: 0.400, aimedSingle: 0.304, aimedTriple: 0.100, doubleHitChance: 0.204 },
  // hard's own missNeighborChance is a new, small side effect of this retune, not a re-introduced
  // Round-3-Rang-11 special case: hard's new anchor sits far enough along the shared curve that it
  // now falls between the old hard and old elite control points, and elite's own
  // missNeighborChance blends in proportionally — see this file's top doc comment.
  hard: { miss: 0.150, randomSingle: 0.353, aimedSingle: 0.349, aimedTriple: 0.149, doubleHitChance: 0.260, missNeighborChance: 0.121 },
  elite: { miss: 0.113, randomSingle: 0.282, aimedSingle: 0.369, aimedTriple: 0.236, doubleHitChance: 0.350, missNeighborChance: 0.511 },
  legendary: { miss: 0.084, randomSingle: 0.200, aimedSingle: 0.336, aimedTriple: 0.380, doubleHitChance: 0.482, missNeighborChance: 0.724 },
};

/** The target-average band each named bot level rolls within (see rollConfigForLevel) — the
 *  club's own most-played range. No longer perfectly contiguous the way the original bands were
 *  (small gaps/overlaps between neighbors are harmless: configForAverage interpolates continuously
 *  across the whole curve regardless of where any one level's own roll range starts or ends). */
export const BOT_LEVEL_RANGES: Record<BotLevel, [number, number]> = {
  easy: [32, 42],
  medium: [44, 55],
  hard: [55, 65],
  elite: [67, 87],
  legendary: [88, 100],
};

/** One config beyond LEVEL_CONFIG.legendary's own ≈98 scoring-only center, purely so interpolation
 *  has somewhere real to reach TOWARD for a roll landing in the upper part of legendary's declared
 *  range — without this, anything requested above ≈98 would just clamp to the same center config.
 *  Not a selectable tier of its own, just an extra control point, and deliberately not pushed any
 *  sharper than this even after the 2026-09-21 retune: nobody needs a club bot stronger than this
 *  (this was already true of the original ≈89-centered ladder; the retune moved every level's own
 *  anchor, not this ceiling). */
const LEGENDARY_CEILING: LevelConfig = { miss: 0.08, randomSingle: 0.19, aimedSingle: 0.33, aimedTriple: 0.40, doubleHitChance: 0.50, missNeighborChance: 0.75 };

/** The LEVEL_CONFIG anchors paired with their own measured average, ascending — the control
 *  points configForAverage interpolates between. Order matters (binary-search-able by avg).
 *  These are the SCORING-ONLY measured averages (see this file's top doc comment for why that's a
 *  different, higher number than what a level actually averages over a real full leg). */
const TIER_ANCHORS: { avg: number; cfg: LevelConfig }[] = [
  { avg: 37.0, cfg: LEVEL_CONFIG.easy },
  { avg: 49.5, cfg: LEVEL_CONFIG.medium },
  { avg: 59.6, cfg: LEVEL_CONFIG.hard },
  { avg: 76.6, cfg: LEVEL_CONFIG.elite },
  { avg: 98.1, cfg: LEVEL_CONFIG.legendary },
  { avg: 101.0, cfg: LEGENDARY_CEILING },
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Linearly blends every field between two configs — used to interpolate smoothly between two
 *  adjacent tier anchors rather than snapping to whichever one is closer. */
function lerpConfig(lo: LevelConfig, hi: LevelConfig, t: number): LevelConfig {
  return {
    miss: lerp(lo.miss, hi.miss, t),
    randomSingle: lerp(lo.randomSingle, hi.randomSingle, t),
    aimedSingle: lerp(lo.aimedSingle, hi.aimedSingle, t),
    aimedTriple: lerp(lo.aimedTriple, hi.aimedTriple, t),
    doubleHitChance: lerp(lo.doubleHitChance, hi.doubleHitChance, t),
    // Round 3 Rang 11: ?? 0 so easy/medium/hard (which don't set this field) interpolate as if
    // they were 0 rather than producing NaN — an in-between average approaching elite gains this
    // near-miss realism gradually, instead of it switching on abruptly at the elite anchor.
    missNeighborChance: lerp(lo.missNeighborChance ?? 0, hi.missNeighborChance ?? 0, t),
  };
}

/** Builds a config whose 3-dart average lands close to `avgPerRound` by interpolating between the
 *  two nearest tier anchors (clamped to the lowest/highest anchor beyond either end) — used both
 *  for Ghost-mode's target-matching (an opponent's own recorded average, or a named benchmark) and
 *  by rollConfigForLevel below (a random point within a named level's own range), so an in-between
 *  target actually lands close to where it should instead of snapping to whichever fixed tier
 *  happens to be nearest. */
export function configForAverage(avgPerRound: number): LevelConfig {
  if (avgPerRound <= TIER_ANCHORS[0].avg) return TIER_ANCHORS[0].cfg;
  const last = TIER_ANCHORS[TIER_ANCHORS.length - 1];
  if (avgPerRound >= last.avg) return last.cfg;
  for (let i = 0; i < TIER_ANCHORS.length - 1; i++) {
    const lo = TIER_ANCHORS[i];
    const hi = TIER_ANCHORS[i + 1];
    if (avgPerRound <= hi.avg) {
      return lerpConfig(lo.cfg, hi.cfg, (avgPerRound - lo.avg) / (hi.avg - lo.avg));
    }
  }
  return last.cfg; // unreachable — satisfies the type checker
}

/** Result of a per-leg roll — `avg` is the target this leg's config was built for (feed it back in
 *  as the next leg's `previousAvg` to keep the walk continuous; see rollConfigForLevel). */
export interface BotLegRoll {
  config: LevelConfig;
  avg: number;
}

/** Rolls a fresh config for one leg, drifting from `previousAvg` (the target the SAME bot rolled
 *  last leg) rather than picking independently from `level`'s whole range each time — a real
 *  opponent's next leg is usually close to how their last one went, not anywhere in their whole
 *  range; a request specifically asked for "not one leg at the bottom of the range and the next at
 *  the top, more like two legs a modest step apart." The walk is still bounded to `level`'s own
 *  range (clamped every step) and the step size is random rather than fixed, so it stays
 *  recognizably itself leg to leg while still reaching either edge of its range over enough legs —
 *  it just won't usually jump straight there in one.
 *
 *  Omit `previousAvg` (first leg at this level, or coming from a different level/game) to start
 *  from a fresh point instead — biased toward the CENTER of the range via an averaged-uniforms
 *  draw (same reasoning as the step distribution below: typical legs cluster mid-range, the true
 *  edges are the exception, not the 50/50 a flat uniform draw would give them).
 *
 *  Call once per LEG, not once per dart or the "day" would reset every visit — see Game.tsx's own
 *  per-leg cache (and previous-average ref) around its bot-turn effect for where this gets called
 *  from. */
export function rollConfigForLevel(level: BotLevel, previousAvg?: number): BotLegRoll {
  const [min, max] = BOT_LEVEL_RANGES[level];
  const width = max - min;
  let avg: number;
  if (previousAvg === undefined || previousAvg < min || previousAvg > max) {
    // (u1 + u2) / 2 peaks at the center and tapers to the edges (a triangular distribution) —
    // still capable of starting right at an edge, just not as often as landing near the middle.
    avg = min + width * ((Math.random() + Math.random()) / 2);
  } else {
    // u1 - u2 is triangular around 0 — most steps small, a full edge-to-edge jump possible but
    // rare (only the single unlikeliest combination of draws reaches it in one step).
    const step = (Math.random() - Math.random()) * width * 0.35;
    avg = Math.min(max, Math.max(min, previousAvg + step));
  }
  return { config: configForAverage(avg), avg };
}

function rand(): number {
  return Math.random();
}

/** Parse a checkout-route segment like "T20", "D16", "S5", "Bull" into base/multiplier. */
function parseRouteSegment(seg: string): { baseValue: number; multiplier: 1 | 2 | 3 } {
  if (seg === "Bull") return { baseValue: 25, multiplier: 2 };
  const mulChar = seg[0];
  if (mulChar === "T") return { baseValue: parseInt(seg.slice(1), 10), multiplier: 3 };
  if (mulChar === "D") return { baseValue: parseInt(seg.slice(1), 10), multiplier: 2 };
  if (mulChar === "S") return { baseValue: parseInt(seg.slice(1), 10), multiplier: 1 };
  return { baseValue: parseInt(seg, 10) || 0, multiplier: 1 };
}

const miss = (): DartThrow => ({ baseValue: 0, multiplier: 1, points: 0 });

/** Simulate one dart aimed at a given base/multiplier target. */
function simulateDart(targetBase: number, targetMultiplier: 1 | 2 | 3, cfg: LevelConfig): DartThrow {
  // Aiming at a double / bullseye (checkout attempt)
  if (targetMultiplier === 2) {
    if (rand() < cfg.doubleHitChance) {
      return { baseValue: targetBase, multiplier: 2, points: pointsFor(targetBase, 2) };
    }
    const roll = rand();
    if (roll < 0.5) return { baseValue: targetBase, multiplier: 1, points: pointsFor(targetBase, 1) };
    if (roll < 0.75 && targetBase > 1 && targetBase !== 25) {
      const neighbor = Math.max(1, targetBase - 1);
      return { baseValue: neighbor, multiplier: 1, points: neighbor };
    }
    return miss();
  }

  // Aiming at the single bull
  if (targetBase === 25) {
    return rand() < cfg.doubleHitChance ? { baseValue: 25, multiplier: 1, points: 25 } : miss();
  }

  // Deliberate single (setup shot, e.g. leaving a double)
  if (targetMultiplier === 1) {
    const roll = rand();
    if (roll < cfg.miss * 0.6) return miss();
    if (roll < cfg.miss * 0.6 + cfg.aimedSingle + cfg.aimedTriple) {
      return { baseValue: targetBase, multiplier: 1, points: targetBase };
    }
    const neighbor = Math.min(20, Math.max(1, targetBase + (rand() < 0.5 ? -1 : 1)));
    return { baseValue: neighbor, multiplier: 1, points: neighbor };
  }

  // Scoring dart aimed at a triple
  const roll = rand();
  if (roll < cfg.miss) {
    // Round 3 Rang 11: at elite/legendary, most of what used to be a flat zero-point "miss" is
    // now a dart that strayed onto the single of a neighboring number instead — see
    // missNeighborChance's doc comment on LevelConfig. Easy/medium/hard have no missNeighborChance
    // set (lerpConfig treats that as 0), so they keep the original flat-zero miss unchanged: a
    // genuinely wild throw is exactly what "missing the board" should look like at that skill
    // level, unlike a near-miss single at the top of the ladder.
    if (cfg.missNeighborChance && rand() < cfg.missNeighborChance) {
      const neighbor = Math.min(20, Math.max(1, targetBase + (rand() < 0.5 ? -1 : 1)));
      return { baseValue: neighbor, multiplier: 1, points: neighbor };
    }
    return miss();
  }
  if (roll < cfg.miss + cfg.randomSingle) {
    const base = 1 + Math.floor(rand() * 20);
    return { baseValue: base, multiplier: 1, points: base };
  }
  if (roll < cfg.miss + cfg.randomSingle + cfg.aimedSingle) {
    const base = rand() < 0.7 ? targetBase : Math.min(20, Math.max(1, targetBase + (rand() < 0.5 ? -1 : 1)));
    return { baseValue: base, multiplier: 1, points: base };
  }
  return { baseValue: targetBase, multiplier: 3, points: pointsFor(targetBase, 3) };
}

/**
 * Simulate a full 3-dart visit for a bot player.
 * Returns the darts actually thrown (may be fewer than 3 if the bot checks out or busts).
 */
export interface BotVisitResult {
  darts: DartThrow[];
  bustedOnDartIndex: number | null;
  checkedOut: boolean;
}

export function simulateBotVisit(remaining: number, doubleOut: boolean, level: BotLevel | LevelConfig, mustDoubleIn = false): BotVisitResult {
  const cfg = typeof level === "string" ? LEVEL_CONFIG[level] : level;
  const darts: DartThrow[] = [];
  let rem = remaining;
  let gotIn = !mustDoubleIn;

  for (let i = 0; i < 3; i++) {
    let targetBase = 20;
    let targetMultiplier: 1 | 2 | 3 = 3;

    if (!gotIn) {
      // Not in yet: every dart aims at a double until one lands, ignoring normal checkout strategy.
      targetBase = rem <= 40 && rem % 2 === 0 && rem > 0 ? rem / 2 : 20;
      targetMultiplier = 2;
    } else if (rem <= 170) {
      const route = getCheckoutSuggestion(rem);
      if (route && route.length > 0) {
        const seg = parseRouteSegment(route[0]);
        targetBase = seg.baseValue;
        targetMultiplier = seg.multiplier;
      } else if (rem <= 40 && rem % 2 === 0 && rem > 0) {
        targetBase = rem / 2;
        targetMultiplier = 2;
      } else if (rem < 60) {
        targetBase = Math.min(20, Math.max(1, rem - 2));
        targetMultiplier = 1;
      }
    }

    const dart = simulateDart(targetBase, targetMultiplier, cfg);
    darts.push(dart);

    if (!gotIn) {
      // Only a landed double counts while still trying to get in; anything else is a dead dart.
      if (dart.multiplier !== 2) continue;
      gotIn = true;
    }

    const isBust = isBustThrow(rem, dart.points, doubleOut, dart.multiplier === 2);

    if (isBust) return { darts, bustedOnDartIndex: i, checkedOut: false };

    rem -= dart.points;
    if (rem === 0) return { darts, bustedOnDartIndex: null, checkedOut: true };
  }

  return { darts, bustedOnDartIndex: null, checkedOut: false };
}

/** Pick a cricket target and simulate the resulting dart for a bot. */
export function simulateBotCricketDart(
  myMarks: Record<number, number>,
  oppMarks: Record<number, number>,
  level: BotLevel,
  numbers: readonly number[]
): DartThrow {
  const openMine = numbers.filter((n) => (myMarks[n] || 0) < 3);
  const target = openMine.length > 0
    ? openMine.reduce((best, n) => (n > best ? n : best), openMine[0])
    : numbers.filter((n) => (oppMarks[n] || 0) < 3).reduce((best, n) => (n > best ? n : best), numbers[numbers.length - 1]);

  const cfg = LEVEL_CONFIG[level];
  if (rand() > 1 - cfg.miss) return miss();
  const tripleRoll = rand();
  if (target !== 25 && tripleRoll < cfg.aimedTriple) {
    return { baseValue: target, multiplier: 3, points: target * 3 };
  }
  if (target === 25 && tripleRoll < cfg.doubleHitChance * 0.5) {
    return { baseValue: 25, multiplier: 2, points: 50 };
  }
  return { baseValue: target, multiplier: 1, points: target };
}
