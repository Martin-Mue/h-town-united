import type { TeamSlot } from "@/types/game";

/**
 * In team mode, remaining/legsWon/cricket/startedScoring are shared per team while throws
 * stay per individual player — players are interleaved [TeamA-1, TeamB-1, TeamA-2, ...] at
 * setup time, so "team index" is just playerIndex % teams.length.
 */
export function teamIndexFor(teams: TeamSlot[] | undefined, playerIdx: number): number {
  return teams && teams.length > 0 ? playerIdx % teams.length : playerIdx;
}
