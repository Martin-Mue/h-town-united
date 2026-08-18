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
