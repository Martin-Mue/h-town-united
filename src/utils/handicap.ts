import type { PlayerSlot, TeamSlot } from "@/types/game";

/**
 * Handicap head-start: a weaker player's individual starting score is the mode's base
 * score minus their handicap points, so they have fewer points to check out from.
 * Team mode always uses the flat base score — with a shared team score it'd be ambiguous
 * whose handicap should count, so per-player handicaps are a singles-only feature.
 */
export function effectiveStartScore(baseStartScore: number, players: PlayerSlot[], playerIdx: number, teams?: TeamSlot[]): number {
  if (teams && teams.length > 0) return baseStartScore;
  const handicap = players[playerIdx]?.handicap ?? 0;
  return Math.max(2, baseStartScore - handicap);
}
