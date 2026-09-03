import type { LegState, PlayerSlot, TeamSlot, CricketPlayerState } from "@/types/game";
import { CRICKET_NUMBERS } from "@/types/game";
import { teamIndexFor } from "@/utils/teamUtils";
import { effectiveStartScore } from "@/utils/handicap";

/** Moved verbatim out of Game.tsx so a second caller (the online-match accept flow, which builds
 *  a fresh GameState outside of Game.tsx's own setup screen) can create a real starting leg
 *  without duplicating this logic — no behavior change for Game.tsx's own existing call sites. */
export function createLegState(legNumber: number, startScore: number, startingPlayerIndex: number, players: PlayerSlot[], teams?: TeamSlot[]): LegState {
  const scoreSlots = teams?.length ?? players.length;
  return {
    legNumber,
    startingPlayerIndex,
    remaining: Array.from({ length: scoreSlots }, (_, i) => effectiveStartScore(startScore, players, i, teams)),
    throws: Array.from({ length: players.length }, () => []),
    startedScoring: teams
      ? Array.from({ length: scoreSlots }, (_, teamIdx) => !players.some((p, i) => teamIndexFor(teams, i) === teamIdx && p.doubleIn))
      : players.map((p) => !p.doubleIn),
  };
}

export function createCricketState(numbers: readonly number[] = CRICKET_NUMBERS): CricketPlayerState {
  const marks: Record<number, number> = {};
  numbers.forEach((n) => (marks[n] = 0));
  return { marks, points: 0 };
}
