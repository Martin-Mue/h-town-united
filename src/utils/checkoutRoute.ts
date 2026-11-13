import { CHECKOUT_ROUTES } from "./checkoutTable";
import type { OutRule } from "./x01Rules";

export interface CheckoutAdvice {
  /** The darts to throw, as labels ("T20", "S5", "D16", "Bull"). */
  darts: string[];
  /** Set for a set-up shot: the score these darts leave for the next visit. Absent for a finish. */
  leaves?: number;
}

export interface CheckoutAdviceOptions {
  /** Darts still in the hand this visit (1-3). */
  dartsLeft?: number;
  /** The double this player hits best ("D16", "Bull"), used where a route can end on it just as well. */
  preferredDouble?: string | null;
  /** "master": the last dart may be a treble as well, so 60 is T20 and 180 is a finish. Double Out when not given. */
  outRule?: OutRule;
}

const labelPoints = (label: string): number => {
  if (label === "Bull") return 50;
  const value = Number(label.slice(1));
  return label[0] === "T" ? value * 3 : label[0] === "D" ? value * 2 : value;
};

/** The doubles a finish may end on, most popular first (a missed D20 or D16 leaves another double). */
const FINISHING_DOUBLES = ["D20", "D16", "D18", "D12", "D10", "D8", "D14", "D19", "D17", "D15", "D13", "D11", "D9", "D7", "D6", "D5", "D4", "D3", "D2", "D1", "Bull"];
/** Master Out: the last dart may also be a treble. Doubles stay first, a missed double more often leaves another finish. */
const MASTER_FINISHERS = [...FINISHING_DOUBLES, ...Array.from({ length: 20 }, (_, i) => `T${20 - i}`)];
/** First darts worth aiming at on the way to a double: the big trebles, then singles, then the rest. */
const LEAD_DARTS = [
  "T20", "T19", "T18", "T17", "T16", "T15", "T14", "T13", "T12", "T11", "T10",
  ...Array.from({ length: 20 }, (_, i) => `S${20 - i}`),
  "Bull", "S25",
  "T9", "T8", "T7", "T6", "T5", "T4", "T3", "T2", "T1",
];
/** Scores worth leaving for the next visit, best first. */
const GOOD_LEAVES = [40, 32, 36, 24, 16, 20, 8, 50, 60, 56, 52, 48, 44, 38, 34, 28, 12, 10, 4, 64, 68, 72, 76, 80];

/** A finish in exactly `darts` darts ending on one of `finishers` (the doubles unless given), or null. Prefers the popular doubles and big first darts. */
function finishIn(remaining: number, darts: number, finishers: string[] = FINISHING_DOUBLES): string[] | null {
  if (darts === 1) {
    const double = finishers.find((d) => labelPoints(d) === remaining);
    return double ? [double] : null;
  }
  for (const double of finishers) {
    const before = remaining - labelPoints(double);
    if (before <= 0) continue;
    if (darts === 2) {
      const lead = LEAD_DARTS.find((d) => labelPoints(d) === before);
      if (lead) return [lead, double];
    } else {
      for (const first of LEAD_DARTS) {
        const second = LEAD_DARTS.find((d) => labelPoints(d) === before - labelPoints(first));
        if (second) return [first, second, double];
      }
    }
  }
  return null;
}

/** Swaps a "single, double" finish for one that ends on the player's best double, when a single makes that possible. */
function onPreferredDouble(route: string[], remaining: number, preferredDouble: string | null | undefined): string[] {
  if (!preferredDouble || route.length !== 2 || !route[0].startsWith("S") || route[1] === preferredDouble) return route;
  const single = remaining - labelPoints(preferredDouble);
  return single >= 1 && single <= 20 ? [`S${single}`, preferredDouble] : route;
}

/** The shortest Master Out finish (last dart a double or treble) that fits into the darts in hand, or null. */
function shortestMasterFinish(remaining: number, dartsLeft: number): string[] | null {
  for (let darts = 1; darts <= dartsLeft; darts++) {
    const finish = finishIn(remaining, darts, MASTER_FINISHERS);
    if (finish) return finish;
  }
  return null;
}

/**
 * What to throw at with `remaining` left, for a double-out player (or a Master Out player, see `outRule`:
 * the usual double route unless a route ending on a treble needs fewer darts, e.g. 60 = T20, 120 = T20 T20).
 *
 * With three darts in hand this is the usual table route. With fewer it is a finish that fits into the darts that
 * are left, or, when there is none, a set-up shot that leaves a good double for the next visit (100 with one dart:
 * T20, leaves 40). Returns null when there is nothing sensible to say (too far away, or no legal dart).
 */
export function checkoutAdvice(remaining: number, options: CheckoutAdviceOptions = {}): CheckoutAdvice | null {
  const dartsLeft = Math.min(3, Math.max(1, options.dartsLeft ?? 3));
  if (!Number.isInteger(remaining) || remaining < 2) return null;

  const tableRoute = CHECKOUT_ROUTES[remaining];
  if (options.outRule === "master") {
    const masterFinish = shortestMasterFinish(remaining, dartsLeft);
    const tableIsAsShort = tableRoute && masterFinish && tableRoute.length <= masterFinish.length;
    if (masterFinish && !tableIsAsShort) return { darts: masterFinish };
  }
  if (tableRoute && tableRoute.length <= dartsLeft) {
    return { darts: onPreferredDouble(tableRoute, remaining, options.preferredDouble) };
  }
  for (let darts = 1; darts <= dartsLeft; darts++) {
    const finish = finishIn(remaining, darts);
    if (finish) return { darts: onPreferredDouble(finish, remaining, options.preferredDouble) };
  }

  // No finish with the darts in hand. With the last dart, say what to leave. (With more darts the player simply scores.)
  // Only inside finishing range: further away the advice would always be "T20".
  if (dartsLeft !== 1 || remaining > 170) return null;
  const preferredLeave = options.preferredDouble ? labelPoints(options.preferredDouble) : null;
  const leaves = preferredLeave ? [preferredLeave, ...GOOD_LEAVES] : GOOD_LEAVES;
  for (const leave of leaves) {
    const lead = LEAD_DARTS.find((d) => labelPoints(d) === remaining - leave);
    if (lead) return { darts: [lead], leaves: leave };
  }
  // Nothing tidy in reach: take the biggest dart that still leaves a finish.
  const lead = LEAD_DARTS.find((d) => remaining - labelPoints(d) >= 2 && remaining - labelPoints(d) in CHECKOUT_ROUTES);
  return lead ? { darts: [lead], leaves: remaining - labelPoints(lead) } : null;
}

/** The darts of a finish that fits into the darts in hand under this out rule, or null when there is none (never a set-up shot). */
export function finishRoute(remaining: number, outRule: OutRule = "double", dartsLeft = 3): string[] | null {
  const advice = checkoutAdvice(remaining, { dartsLeft, outRule });
  return advice && advice.leaves === undefined ? advice.darts : null;
}

/** The double a player hits best, from their per-double record: needs a few attempts to count. */
export function bestDouble(breakdown: { label: string; stats: { attempts: number; percentage: number } }[] | null | undefined, minAttempts = 8): string | null {
  const proven = (breakdown ?? []).filter((b) => b.stats.attempts >= minAttempts);
  if (proven.length === 0) return null;
  return proven.reduce((best, b) => (b.stats.percentage > best.stats.percentage ? b : best)).label;
}
