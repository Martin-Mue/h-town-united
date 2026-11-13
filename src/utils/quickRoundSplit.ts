import { CHECKOUT_ROUTES } from "./checkoutTable";
import { finishRoute } from "./checkoutRoute";

/** One dart of a visit that was entered as a total ("Schnell" grid, typed total, voice). */
export interface SplitDart {
  baseValue: number;
  multiplier: 1 | 2 | 3;
  points: number;
}

export interface SplitVisitOptions {
  /** Score left before this visit. With `doubleOut`, a total equal to it is split as a real finish. */
  remaining?: number;
  /** The player has to finish on a double. */
  doubleOut?: boolean;
  /** Master Out: the player has to finish on a double or a treble (takes precedence over `doubleOut`). */
  masterOut?: boolean;
  /** Double-in is still open: the split has to contain a double, or the visit would score nothing. */
  needsDouble?: boolean;
}

const MISS: SplitDart = { baseValue: 0, multiplier: 1, points: 0 };

/** Every point value one dart can score, 0 included, highest first. */
const DART_POINT_VALUES: number[] = (() => {
  const values = new Set<number>([0, 25, 50]);
  for (let n = 1; n <= 20; n++) {
    values.add(n);
    values.add(n * 2);
    values.add(n * 3);
  }
  return [...values].sort((a, b) => b - a);
})();

const canBeDouble = (points: number) => points === 50 || (points > 0 && points % 2 === 0 && points <= 40);

const asDouble = (points: number): SplitDart => ({ baseValue: points / 2, multiplier: 2, points });

/** The usual way to throw a point value: single first, then triple, then double. */
function dartForPoints(points: number): SplitDart {
  if (points === 0) return MISS;
  if (points <= 20 || points === 25) return { baseValue: points, multiplier: 1, points };
  if (points === 50) return asDouble(points);
  if (points % 3 === 0) return { baseValue: points / 3, multiplier: 3, points };
  return asDouble(points);
}

/** Reads a checkout-table entry such as "T20", "D16", "S5" or "Bull". */
function dartFromRouteLabel(label: string): SplitDart {
  if (label === "Bull") return asDouble(50);
  const multiplier = label[0] === "T" ? 3 : label[0] === "D" ? 2 : 1;
  const baseValue = Number(label.slice(1));
  return { baseValue, multiplier, points: baseValue * multiplier };
}

/** The three point values that add up to `total` and lie closest together, or null if none exist. */
function mostEvenPointValues(total: number, needsDouble: boolean): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let bestSpread = Infinity;
  for (const a of DART_POINT_VALUES) {
    for (const b of DART_POINT_VALUES) {
      if (b > a) continue;
      const c = total - a - b;
      if (c > b || c < 0 || !DART_POINT_VALUES.includes(c)) continue;
      if (needsDouble && !canBeDouble(a) && !canBeDouble(b) && !canBeDouble(c)) continue;
      const spread = a - c;
      if (spread < bestSpread) {
        best = [a, b, c];
        bestSpread = spread;
      }
    }
  }
  return best;
}

/**
 * Turns a visit total into three darts that add up to exactly that total.
 *
 * The darts are made up (nobody knows what was really thrown), but they have to be correct where
 * the rules look at them: a total that finishes a double-out leg ends on a double (taken from the
 * checkout table, so it may be fewer than three darts), one that finishes a Master Out leg ends on a double or treble, and a visit that has to get a player in
 * under double-in contains a double. Returns null for a total no three darts can make.
 */
export function splitVisitTotal(total: number, options: SplitVisitOptions = {}): SplitDart[] | null {
  const { remaining, doubleOut = false, masterOut = false, needsDouble = false } = options;
  if (!Number.isInteger(total) || total < 0 || total > 180) return null;

  if ((doubleOut || masterOut) && !needsDouble && remaining === total) {
    // Master Out: the same route the checkout suggestion shows, so it may end on a treble (60 = T20, 180 = 3x T20).
    const route = masterOut ? finishRoute(total, "master") : CHECKOUT_ROUTES[total];
    if (route) return route.map(dartFromRouteLabel);
  }

  const values = mostEvenPointValues(total, needsDouble) ?? (needsDouble ? mostEvenPointValues(total, false) : null);
  if (!values) return null;

  const darts = values.map(dartForPoints);
  if (needsDouble && !darts.some((d) => d.multiplier === 2)) {
    const idx = values.findIndex(canBeDouble);
    if (idx >= 0) darts[idx] = asDouble(values[idx]);
  }
  return darts;
}
