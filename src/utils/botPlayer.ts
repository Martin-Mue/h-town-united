import type { BotLevel, DartThrow } from "@/types/game";
import { getCheckoutSuggestion } from "@/utils/checkoutTable";
import { isBustThrow, pointsFor } from "@/utils/x01Rules";

/**
 * Bot tuning. 3-dart averages below are MEASURED, not aspirational — simulated 16000 visits per
 * config against a huge remaining score (so scoring behavior is never contaminated by
 * checkout-seeking) via the harness this comment's history came from, not hand-guessed. The whole
 * ladder densely covers 30-100 — the club's actual most-commonly-played average range — with each
 * level's own config sitting at the CENTER of a real per-level RANGE (see BOT_LEVEL_RANGES below),
 * not a single fixed number:
 *   easy      (Lucky Luke)  ≈ 37, range 30-40
 *   medium    (Robin Hood)  ≈ 44, range 40-50
 *   hard      (The Machine) ≈ 55, range 50-60
 *   elite     (Dart Vader)  ≈ 71, range 60-80
 *   legendary (The Prodigy) ≈ 89, range 80-100
 * A real opponent doesn't play the exact same average every leg — some legs go better, some
 * worse — so a bot's EFFECTIVE config for a given leg is rolled fresh from a random point in its
 * level's range (rollConfigForLevel below), not pinned to the anchor config above every time.
 * configForAverage interpolates smoothly between the five anchors instead of snapping to the
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
}

const LEVEL_CONFIG: Record<BotLevel, LevelConfig> = {
  easy: { miss: 0.30, randomSingle: 0.44, aimedSingle: 0.20, aimedTriple: 0.06, doubleHitChance: 0.13 },
  medium: { miss: 0.22, randomSingle: 0.42, aimedSingle: 0.28, aimedTriple: 0.08, doubleHitChance: 0.18 },
  hard: { miss: 0.16, randomSingle: 0.37, aimedSingle: 0.34, aimedTriple: 0.13, doubleHitChance: 0.24 },
  elite: { miss: 0.105, randomSingle: 0.305, aimedSingle: 0.375, aimedTriple: 0.215, doubleHitChance: 0.315 },
  legendary: { miss: 0.075, randomSingle: 0.23, aimedSingle: 0.355, aimedTriple: 0.34, doubleHitChance: 0.43 },
};

/** The target-average band each named bot level rolls within (see rollConfigForLevel) — the
 *  club's own most-played range, split into five contiguous, non-overlapping bands so there's no
 *  gap ANY commonly-played average could fall outside of. */
export const BOT_LEVEL_RANGES: Record<BotLevel, [number, number]> = {
  easy: [30, 40],
  medium: [40, 50],
  hard: [50, 60],
  elite: [60, 80],
  legendary: [80, 100],
};

/** One config beyond LEVEL_CONFIG.legendary's own ≈89 center, purely so interpolation has
 *  somewhere real to reach TOWARD for a roll landing in the upper half of legendary's declared
 *  80-100 range — without this, anything requested above ≈89 would just clamp to the same
 *  center config, and the top of that range would never actually feel any different. Not a
 *  selectable tier of its own, just an extra control point. */
const LEGENDARY_CEILING: LevelConfig = { miss: 0.06, randomSingle: 0.19, aimedSingle: 0.33, aimedTriple: 0.42, doubleHitChance: 0.50 };

/** The LEVEL_CONFIG anchors paired with their own measured average, ascending — the control
 *  points configForAverage interpolates between. Order matters (binary-search-able by avg). */
const TIER_ANCHORS: { avg: number; cfg: LevelConfig }[] = [
  { avg: 36.6, cfg: LEVEL_CONFIG.easy },
  { avg: 44.4, cfg: LEVEL_CONFIG.medium },
  { avg: 55.3, cfg: LEVEL_CONFIG.hard },
  { avg: 70.9, cfg: LEVEL_CONFIG.elite },
  { avg: 89.4, cfg: LEVEL_CONFIG.legendary },
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

/** Rolls a fresh config from somewhere within `level`'s own target-average range — one bot
 *  "having a better or worse day" than the last time it was played, the same leg-to-leg variance
 *  a real opponent brings to the board, without losing what makes that level recognizably itself
 *  (still interpolated from the same anchor configs, just landing at a different point on the
 *  curve). Call once per LEG, not once per dart or the "day" would reset every visit — see
 *  Game.tsx's own per-leg cache around its bot-turn effect for where this gets called from. */
export function rollConfigForLevel(level: BotLevel): LevelConfig {
  const [min, max] = BOT_LEVEL_RANGES[level];
  return configForAverage(min + Math.random() * (max - min));
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
  if (roll < cfg.miss) return miss();
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
