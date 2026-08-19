import { computeCheckoutStats, combineCheckoutStats, type DartThrow, type CheckoutStats } from "./dartStats";

export interface ClutchGameRow {
  id: string;
  best_of_legs: number;
}

export interface ClutchLegRow {
  game_id: string;
  leg_number: number;
  player_index: number;
  player_id: string | null;
  starting_score: number;
  throws: DartThrow[];
  won: boolean;
}

export interface ClutchResult {
  clutch: CheckoutStats;
  normal: CheckoutStats;
}

/** Minimum clutch-checkout attempts before the comparison is shown as meaningful rather than noise. */
export const MIN_CLUTCH_ATTEMPTS = 5;

/** Below this percentage-point gap, "clutch" and "normal" read as the same rate, not a real trend. */
const NEGLIGIBLE_DIFF_PP = 5;

/**
 * Splits a player's checkout attempts into "clutch" (thrown in a leg where either side had
 * already won legsToWin-1 legs — i.e. this leg could end the match) vs "normal" (everything
 * else). Both players in such a leg are under real pressure — one serving to close the match
 * out, the other who must respond or lose it — so every attempt inside that leg counts as
 * clutch for whichever of the two threw it, not only the eventual leg winner.
 *
 * Scoped to true 1v1 games only (exactly two distinct player_index values across the game's
 * legs) — team/multiplayer games don't have a stable per-"side" leg count reconstructable from
 * game_legs alone (player_index there is the individual player's slot, not their team), the same
 * scoping choice the walk-on H2H lookup already makes.
 */
export function computeClutchStats(games: ClutchGameRow[], legs: ClutchLegRow[], playerId: string): ClutchResult {
  const bestOfById = new Map(games.map((g) => [g.id, g.best_of_legs]));
  const legsByGame = new Map<string, ClutchLegRow[]>();
  legs.forEach((l) => {
    if (!legsByGame.has(l.game_id)) legsByGame.set(l.game_id, []);
    legsByGame.get(l.game_id)!.push(l);
  });

  const clutchList: CheckoutStats[] = [];
  const normalList: CheckoutStats[] = [];

  legsByGame.forEach((rows, gameId) => {
    const bestOfLegs = bestOfById.get(gameId);
    if (!bestOfLegs) return;
    const distinctIdx = new Set(rows.map((r) => r.player_index));
    if (distinctIdx.size !== 2) return; // team/multiplayer game — no stable 2-side leg count

    const legsToWin = Math.ceil(bestOfLegs / 2);
    const running: Record<number, number> = {};
    distinctIdx.forEach((idx) => { running[idx] = 0; });

    // Grouped by leg_number first: each leg has one game_legs row PER PLAYER, and both rows for
    // the same leg must see the same "decisive" snapshot (the state before that leg started).
    // Updating `running` row-by-row instead of leg-by-leg would let the second player's row see
    // the first player's own just-applied win and corrupt the decisive check for that tie.
    const byLegNumber = new Map<number, ClutchLegRow[]>();
    rows.forEach((r) => {
      if (!byLegNumber.has(r.leg_number)) byLegNumber.set(r.leg_number, []);
      byLegNumber.get(r.leg_number)!.push(r);
    });

    for (const legNumber of [...byLegNumber.keys()].sort((a, b) => a - b)) {
      const legRows = byLegNumber.get(legNumber)!;
      const decisive = Object.values(running).some((n) => n === legsToWin - 1);
      for (const leg of legRows) {
        if (leg.player_id === playerId && Array.isArray(leg.throws) && leg.throws.length > 0) {
          const stats = computeCheckoutStats(leg.throws, leg.starting_score);
          (decisive ? clutchList : normalList).push(stats);
        }
      }
      for (const leg of legRows) {
        if (leg.won) running[leg.player_index] += 1;
      }
    }
  });

  return { clutch: combineCheckoutStats(clutchList), normal: combineCheckoutStats(normalList) };
}

/** One-line takeaway comparing clutch vs. normal checkout rate. Caller is responsible for
 *  checking `clutch.attempts >= MIN_CLUTCH_ATTEMPTS` first — this always returns a verdict. */
export function describeClutchTakeaway({ clutch, normal }: ClutchResult): string {
  const diff = clutch.percentage - normal.percentage;
  if (Math.abs(diff) < NEGLIGIBLE_DIFF_PP) {
    return "Kein messbarer Unterschied unter Druck — genauso zuverlässig wie sonst.";
  }
  const diffAbs = Math.abs(diff).toFixed(0);
  return diff > 0
    ? `Unter Druck triffst du sogar häufiger — ${diffAbs} Prozentpunkte über deiner normalen Quote. Echter Clutch-Faktor.`
    : `Unter Druck sinkt deine Quote um ${diffAbs} Prozentpunkte gegenüber sonst — der Moment, an dem sich gezieltes Üben am meisten lohnt.`;
}
