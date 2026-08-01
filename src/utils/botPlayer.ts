import type { BotLevel, DartThrow } from "@/types/game";
import { getCheckoutSuggestion } from "@/utils/checkoutTable";

/** Approximate per-level accuracy tuning to roughly hit target 3-dart averages. */
const LEVEL_CONFIG: Record<BotLevel, { scatter: number; doubleHitChance: number }> = {
  easy: { scatter: 5.5, doubleHitChance: 0.28 },
  medium: { scatter: 3.2, doubleHitChance: 0.42 },
  hard: { scatter: 1.3, doubleHitChance: 0.62 },
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

/** Simulate one dart aimed at a given base/multiplier target, with level-dependent scatter. */
function simulateDart(targetBase: number, targetMultiplier: 1 | 2 | 3, level: BotLevel): DartThrow {
  const cfg = LEVEL_CONFIG[level];

  // Special-case: aiming for a double or bullseye — model as hit/miss with a fallback ring.
  if (targetMultiplier === 2 || (targetBase === 25 && targetMultiplier === 2)) {
    const hit = rand() < cfg.doubleHitChance;
    if (hit) {
      const points = pointsFor(targetBase, targetMultiplier);
      return { baseValue: targetBase, multiplier: targetMultiplier, points };
    }
    // Miss the double: commonly lands single of same number, or just outside (miss/adjacent single)
    const roll = rand();
    if (roll < 0.55) {
      const points = pointsFor(targetBase, 1);
      return { baseValue: targetBase, multiplier: 1, points };
    }
    if (roll < 0.8 && targetBase > 1 && targetBase !== 25) {
      const neighbor = Math.max(1, targetBase - 1);
      return { baseValue: neighbor, multiplier: 1, points: neighbor };
    }
    return { baseValue: 0, multiplier: 1, points: 0 };
  }

  // General scoring throw: scatter around target using a normal-ish distribution.
  const offset = (rand() + rand() + rand() - 1.5) * cfg.scatter;
  const scaledOffset = Math.round(offset / 2);

  if (targetBase === 25) {
    // Aiming at bull (single 25): scatter can miss to nearby low numbers.
    const hit = rand() < (1 - cfg.scatter / 12);
    if (hit) return { baseValue: 25, multiplier: 1, points: 25 };
    return { baseValue: 0, multiplier: 1, points: 0 };
  }

  // Roll for multiplier accuracy around the intended triple/single.
  let base = Math.min(20, Math.max(1, targetBase + scaledOffset));
  let multiplier: 1 | 2 | 3 = targetMultiplier;
  const accuracy = rand();
  if (targetMultiplier === 3) {
    if (accuracy < cfg.doubleHitChance) {
      multiplier = 3;
    } else if (accuracy < cfg.doubleHitChance + 0.35) {
      multiplier = 1; // hit the single area of the same number (missed the triple ring)
    } else {
      multiplier = 1;
      base = Math.min(20, Math.max(1, base + (rand() < 0.5 ? -1 : 1)));
    }
  }
  const points = pointsFor(base, multiplier);
  return { baseValue: base, multiplier, points };
}

/**
 * Simulate a full 3-dart visit for a bot player.
 * Returns the darts actually thrown (may be fewer than 3 if the bot checks out or busts).
 * Bust behaviour matches human rules: bust darts still "count" as thrown but the
 * caller (Game.tsx) is responsible for reverting remaining/throws on bust, exactly
 * like it does for human throws — so this function reports whether the visit busted.
 */
export interface BotVisitResult {
  darts: DartThrow[];
  bustedOnDartIndex: number | null; // index within darts[] that caused the bust, if any
  checkedOut: boolean;
}

export function simulateBotVisit(remaining: number, doubleOut: boolean, level: BotLevel): BotVisitResult {
  const darts: DartThrow[] = [];
  let rem = remaining;

  for (let i = 0; i < 3; i++) {
    let targetBase = 20;
    let targetMultiplier: 1 | 2 | 3 = 3;

    if (rem <= 170) {
      const route = getCheckoutSuggestion(rem);
      if (route && route.length > 0) {
        const seg = parseRouteSegment(route[0]);
        targetBase = seg.baseValue;
        targetMultiplier = seg.multiplier;
      } else if (rem <= 40 && rem % 2 === 0 && rem > 0) {
        targetBase = rem / 2;
        targetMultiplier = 2;
      } else if (rem < 60) {
        // No clean route (e.g. bogey numbers): reduce safely.
        targetBase = Math.min(20, Math.max(1, rem - 2));
        targetMultiplier = 1;
      }
    }

    const dart = simulateDart(targetBase, targetMultiplier, level);
    const newRem = rem - dart.points;
    const isBust = newRem < 0 || newRem === 1 ||
      (newRem === 0 && doubleOut && !(dart.multiplier === 2 || (dart.baseValue === 25 && dart.multiplier === 2)));

    darts.push(dart);

    if (isBust) {
      return { darts, bustedOnDartIndex: i, checkedOut: false };
    }

    rem = newRem;
    if (rem === 0) {
      return { darts, bustedOnDartIndex: null, checkedOut: true };
    }
  }

  return { darts, bustedOnDartIndex: null, checkedOut: false };
}
