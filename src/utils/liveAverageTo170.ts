import type { GameState } from "@/types/game";
import { averageToCheckoutRange, combineScoringPhaseTotals, scoringPhaseTotals } from "@/utils/averageToCheckoutRange";
import { effectiveStartScore } from "@/utils/handicap";

/** Average-to-170 per player over the whole running match (finished legs plus the current one),
 *  for the tournament live view. Null while a player has no throw above 170 yet. */
export function liveAveragesTo170(game: GameState): (number | null)[] {
  const allLegs = [...game.completedLegs, game.currentLeg];
  return game.players.map((_, i) => {
    const startingScore = effectiveStartScore(game.startScore, game.players, i, game.teams);
    const phases = allLegs.map((leg) => scoringPhaseTotals(leg.throws[i] ?? [], startingScore));
    return averageToCheckoutRange(combineScoringPhaseTotals(phases));
  });
}
