import { computeCheckoutStats, combineCheckoutStats, type DartThrow, type CheckoutStats } from "./dartStats";

export interface ClutchGameRow {
  id: string;
  best_of_legs: number;
  /** Team mode (see teamUtils.ts) — teams are always exactly 2, interleaved, so a player's
   *  "side" for the running leg-count below is player_index % 2 instead of player_index itself. */
  isTeamGame?: boolean;
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
 * Scoped to true 1v1 games and exactly-2-team games (which reduce to 2 "sides" the same way) —
 * genuine 3+-way free-for-all games don't have a stable per-side leg count reconstructable from
 * game_legs alone (player_index there is the individual player's slot, and with no team grouping
 * there's no principled way to pair players into 2 sides), the same scoping choice the walk-on
 * H2H lookup already makes.
 */
export function computeClutchStats(games: ClutchGameRow[], legs: ClutchLegRow[], playerId: string): ClutchResult {
  const bestOfById = new Map(games.map((g) => [g.id, g.best_of_legs]));
  const teamGameIds = new Set(games.filter((g) => g.isTeamGame).map((g) => g.id));
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
    // Team games are always exactly 2 teams, interleaved [TeamA-1, TeamB-1, TeamA-2, ...] — see
    // teamUtils.ts — so a player's "side" is player_index % 2 there; for non-team games "side" is
    // just the player_index itself (identity), same as before this function knew about teams.
    const isTeam = teamGameIds.has(gameId);
    const sideOf = (playerIndex: number) => (isTeam ? playerIndex % 2 : playerIndex);
    const distinctSides = new Set(rows.map((r) => sideOf(r.player_index)));
    if (distinctSides.size !== 2) return; // free-for-all game — no stable 2-side leg count

    const legsToWin = Math.ceil(bestOfLegs / 2);
    const running: Record<number, number> = {};
    distinctSides.forEach((side) => { running[side] = 0; });

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
      // Dedupe by side, not by row: in a team game both members of the winning team's rows for
      // this leg carry the same won=true, and counting each row separately would credit that
      // side's running leg-count twice per leg.
      const wonSidesThisLeg = new Set<number>();
      for (const leg of legRows) {
        if (leg.won) wonSidesThisLeg.add(sideOf(leg.player_index));
      }
      wonSidesThisLeg.forEach((side) => { running[side] += 1; });
    }
  });

  return { clutch: combineCheckoutStats(clutchList), normal: combineCheckoutStats(normalList) };
}

/** One-line takeaway comparing clutch vs. normal checkout rate. Caller is responsible for
 *  checking `clutch.attempts >= MIN_CLUTCH_ATTEMPTS` first — this always returns a verdict. */
export function describeClutchTakeaway({ clutch, normal }: ClutchResult, t: (key: string) => string): string {
  const diff = clutch.percentage - normal.percentage;
  if (Math.abs(diff) < NEGLIGIBLE_DIFF_PP) {
    return t("clutch.noDifference");
  }
  const diffAbs = Math.abs(diff).toFixed(0);
  return diff > 0
    ? `${t("clutch.higherUnderPressurePrefix")} ${diffAbs} ${t("clutch.higherUnderPressureSuffix")}`
    : `${t("clutch.lowerUnderPressurePrefix")} ${diffAbs} ${t("clutch.lowerUnderPressureSuffix")}`;
}
