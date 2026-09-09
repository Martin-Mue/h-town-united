import type { GameState } from "@/types/game";
import { computeLegStatBundle, combineStatBundles, type StatBundle } from "@/utils/dartStats";
import { teamIndexFor } from "@/utils/teamUtils";
import { effectiveStartScore } from "@/utils/handicap";

export interface PostGameStat {
  name: string;
  legs: number;
  perLeg: StatBundle[];
  overall: StatBundle;
}

/** Per-player match-total + per-leg stat breakdown for the post-game screen — pure function of
 *  the finished game, called from a `useMemo(() => computePostGameStats(game), [game])` in
 *  Game.tsx. No code path calls setGame again once isFinished is true (every scoring handler
 *  guards on `!game.isFinished`), so a game reference only ever needs computing once here. */
export function computePostGameStats(game: GameState | null): PostGameStat[] | null {
  if (!game || !game.isFinished) return null;
  const allLegs = [...game.completedLegs, game.currentLeg];
  const isCricket = game.mode === "cricket";
  // Total legs won across the WHOLE match, not `game.legsWon` directly — without Sets-Modus
  // those are identical (legsWon just accumulates all match long), but with it active,
  // `legsWon` only ever holds the CURRENT set's tally and resets to zero at every set boundary
  // (see legLogic.ts's applyLegWin), so reading it straight at match end would silently report
  // only the final set's leg score instead of the real match-wide total this screen has always
  // shown for `p.legs`.
  const totalLegsFor = (scoreSlot: number) => allLegs.filter((leg) => leg.winnerIndex === scoreSlot).length;
  return game.players.map((p, i) => {
    const startingScore = effectiveStartScore(game.startScore, game.players, i, game.teams);
    const perLeg = allLegs.map((leg) => computeLegStatBundle(leg.throws[i] ?? [], startingScore, isCricket));
    const overall = combineStatBundles(perLeg, allLegs.flatMap((leg) => leg.throws[i] ?? []));
    return {
      name: p.name,
      legs: totalLegsFor(teamIndexFor(game.teams, i)),
      perLeg,
      overall,
    };
  });
}
