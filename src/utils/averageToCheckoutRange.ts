import type { DartThrow } from "@/utils/dartStats";

/** Highest remaining score a single 3-dart visit can still finish (T20 T20 Bull). */
export const MAX_CHECKOUT_REMAINING = 170;

/** Points and darts thrown during the "scoring phase" of a leg — every visit that STARTED on a
 *  remaining score above 170, i.e. while no checkout was theoretically possible yet. Kept as a
 *  points/darts pair (not just a finished average) so several legs combine exactly by summing,
 *  the same way the overall average does. */
export interface ScoringPhaseTotals {
  points: number;
  darts: number;
}

export const EMPTY_SCORING_PHASE: ScoringPhaseTotals = { points: 0, darts: 0 };

/**
 * Replays one leg and sums up everything thrown before a finish became possible.
 *
 * A visit counts when the score it started on was still above 170; the visit that drops the
 * remaining score to 170 or below is therefore the last one included, and everything after it
 * (the finishing phase) is excluded. Busted visits are never persisted, so subtracting visit
 * totals gives the exact remaining score. A leg that starts at or below 170 has no scoring
 * phase at all. Hole placeholders (deleted darts awaiting correction) contribute neither points
 * nor darts.
 */
export function scoringPhaseTotals(throws: DartThrow[], startingScore: number): ScoringPhaseTotals {
  let remaining = startingScore;
  let points = 0;
  let darts = 0;
  for (let i = 0; i < throws.length && remaining > MAX_CHECKOUT_REMAINING; i += 3) {
    const visit = throws.slice(i, i + 3).filter((dart) => dart.baseValue !== -1);
    const visitPoints = visit.reduce((sum, dart) => sum + dart.points, 0);
    points += visitPoints;
    darts += visit.length;
    remaining -= visitPoints;
  }
  return { points, darts };
}

export const combineScoringPhaseTotals = (all: ScoringPhaseTotals[]): ScoringPhaseTotals => ({
  points: all.reduce((sum, t) => sum + t.points, 0),
  darts: all.reduce((sum, t) => sum + t.darts, 0),
});

/** Three-dart average over the scoring phase, or null when there was none (nothing to show —
 *  distinct from a genuine average of 0). */
export const averageToCheckoutRange = (totals: ScoringPhaseTotals): number | null =>
  totals.darts > 0 ? (totals.points / totals.darts) * 3 : null;
