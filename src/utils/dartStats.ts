export interface DartThrow {
  baseValue: number;
  multiplier: number;
  points: number;
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
    const isAttempt = remaining > 1 && remaining <= 170;
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
