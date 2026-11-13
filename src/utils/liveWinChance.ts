import type { GameState } from "@/types/game";
import { effectiveStartScore } from "@/utils/handicap";

/**
 * A live estimate of who wins a two-sided X01 match, from what has happened in it so far.
 *
 * It is an estimate for the scoreboard, not a statistic: each side's pace is its three-dart average in this match
 * (pulled towards a typical club average while only a few darts are thrown), a leg is a race over the visits each
 * side still needs, and the match is all the legs still to play with the throw alternating.
 */

/** What a player is assumed to average before the match says otherwise. */
const TYPICAL_AVERAGE = 45;
/** How many darts of "typical" stand against the real ones: after about two legs the real average dominates. */
const PRIOR_DARTS = 18;
/** Visits a finish costs on top of pure scoring (set-up and missed doubles). */
const FINISHING_VISITS = 1.3;
/** How sharply a lead in visits turns into a likely win: one visit ahead is roughly three in four. */
const STEEPNESS = 1.1;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Three-dart average of one side over the whole match so far, steadied by the typical average. */
export function steadiedAverage(pointsScored: number, dartsThrown: number): number {
  const perDart = (TYPICAL_AVERAGE / 3 * PRIOR_DARTS + pointsScored) / (PRIOR_DARTS + dartsThrown);
  return clamp(perDart * 3, 15, 120);
}

/** Visits a side still needs for `remaining` at its pace. */
export const visitsToFinish = (remaining: number, average: number): number => remaining / average + FINISHING_VISITS;

/** Chance that side A wins a leg, given the visits each still needs and who throws next. */
export function legWinChance(visitsA: number, visitsB: number, aThrowsNext: boolean): number {
  const lead = visitsB - visitsA + (aThrowsNext ? 0.5 : -0.5);
  return 1 / (1 + Math.exp(-STEEPNESS * lead));
}

/**
 * Chance that side A wins the match once the current leg is decided with `currentLegChance`, when later legs are
 * won by A with `whenAStarts` / `whenBStarts` and the throw alternates from `aStartsNextLeg`.
 */
export function matchWinChance(
  legsA: number, legsB: number, legsToWin: number,
  currentLegChance: number, whenAStarts: number, whenBStarts: number, aStartsNextLeg: boolean,
): number {
  const memo = new Map<string, number>();
  const from = (a: number, b: number, aStarts: boolean): number => {
    if (a >= legsToWin) return 1;
    if (b >= legsToWin) return 0;
    const key = `${a}:${b}:${aStarts}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const p = aStarts ? whenAStarts : whenBStarts;
    const value = p * from(a + 1, b, !aStarts) + (1 - p) * from(a, b + 1, !aStarts);
    memo.set(key, value);
    return value;
  };
  return currentLegChance * from(legsA + 1, legsB, aStartsNextLeg) + (1 - currentLegChance) * from(legsA, legsB + 1, aStartsNextLeg);
}

/**
 * The chance (0-1) that the first of two players wins the match, or null where the estimate does not apply:
 * Cricket, teams, more than two players, sets, a finished game, or before the first dart.
 */
export function liveWinChance(game: GameState): number | null {
  if (game.mode === "cricket" || game.teams || game.players.length !== 2 || game.setsMode || game.isFinished) return null;
  const legs = [...game.completedLegs, game.currentLeg];
  const totals = [0, 1].map((i) => {
    const throws = legs.flatMap((leg) => leg.throws[i] ?? []);
    return { darts: throws.length, points: throws.reduce((sum, t) => sum + t.points, 0) };
  });
  if (totals[0].darts + totals[1].darts === 0) return null;

  const averages = totals.map((t) => steadiedAverage(t.points, t.darts));
  const starts = [0, 1].map((i) => effectiveStartScore(game.startScore, game.players, i, game.teams));
  const current = legWinChance(
    visitsToFinish(game.currentLeg.remaining[0], averages[0]),
    visitsToFinish(game.currentLeg.remaining[1], averages[1]),
    game.currentPlayerIndex === 0,
  );
  const fresh = (aStarts: boolean) => legWinChance(visitsToFinish(starts[0], averages[0]), visitsToFinish(starts[1], averages[1]), aStarts);
  const aStartsNextLeg = (game.currentLeg.startingPlayerIndex + 1) % 2 === 0;
  return matchWinChance(game.legsWon[0], game.legsWon[1], Math.ceil(game.bestOfLegs / 2), current, fresh(true), fresh(false), aStartsNextLeg);
}
