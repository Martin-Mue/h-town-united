import type { BotLevel, DartThrow } from "@/types/game";
import { getCheckoutSuggestion } from "@/utils/checkoutTable";

/**
 * Bot tuning. Targets roughly these 3-dart averages:
 *   easy   ≈ 25–30
 *   medium ≈ 45–50
 *   hard   ≈ 68–75
 * (Club-realistic range of ~20–80 requested by the users.)
 */
interface LevelConfig {
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
  easy: { miss: 0.35, randomSingle: 0.45, aimedSingle: 0.17, aimedTriple: 0.03, doubleHitChance: 0.10 },
  medium: { miss: 0.18, randomSingle: 0.42, aimedSingle: 0.30, aimedTriple: 0.10, doubleHitChance: 0.20 },
  hard: { miss: 0.10, randomSingle: 0.30, aimedSingle: 0.38, aimedTriple: 0.22, doubleHitChance: 0.32 },
};

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

function pointsFor(baseValue: number, multiplier: number): number {
  return baseValue === 25 && multiplier === 3 ? 0 : baseValue * multiplier;
}

const miss = (): DartThrow => ({ baseValue: 0, multiplier: 1, points: 0 });

/** Simulate one dart aimed at a given base/multiplier target. */
function simulateDart(targetBase: number, targetMultiplier: 1 | 2 | 3, level: BotLevel): DartThrow {
  const cfg = LEVEL_CONFIG[level];

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

export function simulateBotVisit(remaining: number, doubleOut: boolean, level: BotLevel, mustDoubleIn = false): BotVisitResult {
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

    const dart = simulateDart(targetBase, targetMultiplier, level);
    darts.push(dart);

    if (!gotIn) {
      // Only a landed double counts while still trying to get in; anything else is a dead dart.
      if (dart.multiplier !== 2) continue;
      gotIn = true;
    }

    const newRem = rem - dart.points;
    const isBust = newRem < 0 || newRem === 1 ||
      (newRem === 0 && doubleOut && !(dart.multiplier === 2 || (dart.baseValue === 25 && dart.multiplier === 2)));

    if (isBust) return { darts, bustedOnDartIndex: i, checkedOut: false };

    rem = newRem;
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
