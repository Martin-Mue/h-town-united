import { isCheckoutPossible } from "@/utils/checkoutTable";

/** "Erfahrung" (experience) skill value for a 0-100 radar chart — Players.tsx's own player-
 *  detail radar and Statistics.tsx's H2H comparison radar independently picked different
 *  saturation points for the same skill (`*2`, maxing out at 50 games, vs `*5`, at 20), so the
 *  same player could show a different "Erfahrung" value depending which page you're on. Settled
 *  on the *2/50-games saturation point — a more meaningful "very experienced" bar for a casual
 *  club than 20 games, which a regular player reaches within a few weeks. */
export function experienceScore(gamesPlayed: number): number {
  return Math.min(gamesPlayed * 2, 100);
}

export interface DartThrow {
  baseValue: number;
  multiplier: number;
  points: number;
  /** Tip position in board-relative unit coordinates (0,0 = bull, radius ~1 = double edge), camera-scored throws only. */
  boardU?: number;
  boardV?: number;
}

/** Darts grouped into visits of up to 3. */
const visits = (throws: DartThrow[]): DartThrow[][] => {
  const out: DartThrow[][] = [];
  for (let i = 0; i < throws.length; i += 3) out.push(throws.slice(i, i + 3));
  return out;
};

export const average = (throws: DartThrow[]): number => {
  if (throws.length === 0) return 0;
  return (throws.reduce((sum, t) => sum + t.points, 0) / throws.length) * 3;
};

export const highestVisit = (throws: DartThrow[]): number => {
  let max = 0;
  for (const v of visits(throws)) {
    const points = v.reduce((s, t) => s + t.points, 0);
    if (points > max) max = points;
  }
  return max;
};

export const first9Average = (throws: DartThrow[]): number => {
  const first9 = throws.slice(0, 9);
  if (first9.length === 0) return 0;
  return (first9.reduce((s, t) => s + t.points, 0) / first9.length) * 3;
};

export const tonPlusCount = (throws: DartThrow[]): number =>
  visits(throws).filter((v) => v.reduce((s, t) => s + t.points, 0) >= 100).length;

export const count180s = (throws: DartThrow[]): number =>
  visits(throws).filter((v) => v.reduce((s, t) => s + t.points, 0) === 180).length;

// ─── Round-score distribution ────────────────────────────────────────
export interface ScoreTierCount {
  label: string;
  count: number;
}

/** 20-point bands from 40 up to the 180 max. Visits below 40 are the normal case (not the
 *  point of this view) and simply fall through uncounted, rather than being lumped into a
 *  dominant "0-39" bucket that would dwarf every other bar. */
const SCORE_TIER_BOUNDS: readonly [label: string, min: number, max: number][] = [
  ["40+", 40, 59], ["60+", 60, 79], ["80+", 80, 99], ["100+", 100, 119],
  ["120+", 120, 139], ["140+", 140, 159], ["160+", 160, 179], ["180", 180, 180],
];

/** Histogram of 3-dart visit totals across the bands above — how many rounds were "just a
 *  40" vs. "a 140", not just the single average number. */
export function scoreTierBreakdown(throws: DartThrow[]): ScoreTierCount[] {
  const counts = SCORE_TIER_BOUNDS.map(() => 0);
  for (const v of visits(throws)) {
    const points = v.reduce((s, t) => s + t.points, 0);
    const idx = SCORE_TIER_BOUNDS.findIndex(([, min, max]) => points >= min && points <= max);
    if (idx >= 0) counts[idx]++;
  }
  return SCORE_TIER_BOUNDS.map(([label], i) => ({ label, count: counts[i] }));
}

// ─── Individual-field breakdown ──────────────────────────────────────
/** Board numbers worth a row in a field-hit breakdown, highest first then the bull — same
 *  ordering convention as CRICKET_NUMBERS/the in-game Cricket marks table. */
export const SEGMENT_NUMBERS = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 25] as const;

export interface SegmentCounts {
  /** hits[baseValue][multiplier] — baseValue 1-20 or 25, multiplier 1(single)/2(double)/3(triple);
   *  25 has no triple, there's no triple-bull ring). */
  hits: Record<number, Record<number, number>>;
  misses: number;
}

/** How often each exact board segment (Triple 20, Single 1, Bullseye, ...) was hit. Kept
 *  separate from the tier/average stats above since this is meant to be opt-in extra detail,
 *  not part of the at-a-glance comparison. */
export function segmentBreakdown(throws: DartThrow[]): SegmentCounts {
  const hits: Record<number, Record<number, number>> = {};
  let misses = 0;
  for (const t of throws) {
    if (t.baseValue === 0) { misses++; continue; }
    const byMult = hits[t.baseValue] || (hits[t.baseValue] = {});
    byMult[t.multiplier] = (byMult[t.multiplier] || 0) + 1;
  }
  return { hits, misses };
}

export function segmentCount(sb: SegmentCounts, baseValue: number, multiplier: number): number {
  return sb.hits[baseValue]?.[multiplier] ?? 0;
}

export interface CheckoutStats {
  /** Visits where the player started on a possible checkout (remaining <= 170). */
  attempts: number;
  /** Of those, visits that actually reduced remaining to exactly 0. */
  hits: number;
  /** hits / attempts, 0-100. */
  percentage: number;
  /** Highest single-visit checkout (0 if the leg wasn't won by this player). */
  highestCheckout: number;
}

/**
 * Replays a leg's raw throw sequence against its starting score to work out
 * checkout attempts/hits. Busted visits are never persisted (see game_legs
 * migration comment), so a plain running total of visit points is exact.
 */
export function computeCheckoutStats(throws: DartThrow[], startingScore: number): CheckoutStats {
  let remaining = startingScore;
  let attempts = 0;
  let hits = 0;
  let highestCheckout = 0;
  for (const v of visits(throws)) {
    // A visit only counts as a checkout ATTEMPT if the score it started on is actually
    // achievable in 3 darts ending on a double — 162/163/165/166/168/169 aren't (no combination
    // of darts reaches them under double-out), so counting them here silently deflated every
    // player's checkout % by padding the denominator with attempts that could never succeed.
    const isAttempt = isCheckoutPossible(remaining);
    if (isAttempt) attempts++;
    const visitPoints = v.reduce((s, t) => s + t.points, 0);
    remaining -= visitPoints;
    if (remaining === 0) {
      hits++;
      if (visitPoints > highestCheckout) highestCheckout = visitPoints;
    }
  }
  return {
    attempts,
    hits,
    percentage: attempts > 0 ? Math.round((hits / attempts) * 1000) / 10 : 0,
    highestCheckout,
  };
}

/** The only 3-dart visit totals between 0 and 180 that no combination of three legal darts (each
 *  0-20, 25, or 50, with an allowed multiplier) can reach — a fixed, well-known fact about dart
 *  scoring geometry, not something derived per call. Used to reject a typed/free-entry total
 *  that can't correspond to any real visit, so a mis-typed total doesn't get silently fabricated
 *  into made-up per-dart throws (see splitQuickRound in Game.tsx). */
const UNREACHABLE_VISIT_TOTALS = new Set([179, 178, 176, 175, 173, 172, 169, 166, 163]);

export function isAchievableVisitTotal(total: number): boolean {
  return Number.isInteger(total) && total >= 0 && total <= 180 && !UNREACHABLE_VISIT_TOTALS.has(total);
}

/** Aggregates checkout stats across multiple legs (same player, one game or a whole career). */
export function combineCheckoutStats(all: CheckoutStats[]): CheckoutStats {
  const attempts = all.reduce((s, c) => s + c.attempts, 0);
  const hits = all.reduce((s, c) => s + c.hits, 0);
  const highestCheckout = all.reduce((m, c) => Math.max(m, c.highestCheckout), 0);
  return {
    attempts,
    hits,
    percentage: attempts > 0 ? Math.round((hits / attempts) * 1000) / 10 : 0,
    highestCheckout,
  };
}

// ─── Cricket ──────────────────────────────────────────────────────────
const CRICKET_MARK_NUMBERS = [20, 19, 18, 17, 16, 15, 25];

export interface CricketStats {
  marks: number;
  rounds: number;
  /** Marks Per Round — the standard Cricket average (3 darts = 1 round). */
  mpr: number;
  /** % of darts that landed on a scoring Cricket number (15-20 or Bull), regardless of multiplier. */
  hitRate: number;
  totalDarts: number;
}

export function computeCricketStats(throws: DartThrow[]): CricketStats {
  const totalDarts = throws.length;
  const rounds = Math.ceil(totalDarts / 3);
  let marks = 0;
  let hits = 0;
  for (const t of throws) {
    if (!CRICKET_MARK_NUMBERS.includes(t.baseValue)) continue;
    hits++;
    marks += t.baseValue === 25 ? (t.multiplier === 2 ? 2 : 1) : t.multiplier;
  }
  return {
    marks,
    rounds,
    mpr: rounds > 0 ? Math.round((marks / rounds) * 100) / 100 : 0,
    hitRate: totalDarts > 0 ? Math.round((hits / totalDarts) * 1000) / 10 : 0,
    totalDarts,
  };
}

/** Aggregates Cricket stats across multiple legs. */
export function combineCricketStats(all: CricketStats[]): CricketStats {
  const marks = all.reduce((s, c) => s + c.marks, 0);
  const rounds = all.reduce((s, c) => s + c.rounds, 0);
  const totalDarts = all.reduce((s, c) => s + c.totalDarts, 0);
  const hits = all.reduce((s, c) => s + Math.round((c.hitRate / 100) * c.totalDarts), 0);
  return {
    marks,
    rounds,
    mpr: rounds > 0 ? Math.round((marks / rounds) * 100) / 100 : 0,
    hitRate: totalDarts > 0 ? Math.round((hits / totalDarts) * 1000) / 10 : 0,
    totalDarts,
  };
}
