import type { GameState } from "@/types/game";
import { teamIndexFor } from "@/utils/teamUtils";

/** Bull-off: before the match each side throws ONE dart at the bull, the closer dart starts.
 *  Board-relative coordinates (boardU/boardV, see DetectedDart) put the bull at (0,0) and the outer
 *  edge of the double ring at radius 1 = 170 mm on a standard board. */
export const DOUBLE_OUTER_RADIUS_MM = 170;

/** Darts closer to each other than this count as a tie — below the measuring accuracy of a phone
 *  camera, so "who was closer" would be a coin flip dressed up as a measurement. */
export const BULLOFF_TIE_MM = 1.5;

export const distanceFromBullMm = (boardU: number, boardV: number): number =>
  Math.round(Math.hypot(boardU, boardV) * DOUBLE_OUTER_RADIUS_MM * 10) / 10;

/** Manual fallback (no camera / not calibrated): the thrower picks a rough zone and gets a typical
 *  distance for it. Coarse on purpose — equal zones tie and the pair throws again. */
export const BULLOFF_ZONES = [
  { id: "bullseye", mm: 3 },
  { id: "bull", mm: 11 },
  { id: "near", mm: 45 },
  { id: "far", mm: 95 },
  { id: "miss", mm: 220 },
] as const;
export type BullOffZoneId = (typeof BULLOFF_ZONES)[number]["id"];
export const zoneDistanceMm = (id: BullOffZoneId): number => BULLOFF_ZONES.find((z) => z.id === id)!.mm;

export type BullOffOutcome =
  | { status: "waiting" }
  | { status: "tie" }
  | { status: "winner"; winner: 0 | 1; closerByMm: number };

/** distances[0] / distances[1] = the two contenders; null = not thrown yet. */
export function decideBullOff(distances: readonly (number | null)[]): BullOffOutcome {
  const [a, b] = distances;
  if (a === null || a === undefined || b === null || b === undefined) return { status: "waiting" };
  const diff = Math.abs(a - b);
  if (diff < BULLOFF_TIE_MM) return { status: "tie" };
  return { status: "winner", winner: a < b ? 0 : 1, closerByMm: Math.round(diff * 10) / 10 };
}

/** The two contenders' player slots: players 0 and 1. In team mode (players interleaved
 *  [A1, B1, A2, B2]) these are exactly the first member of each team. */
export const BULLOFF_SLOTS = [0, 1] as const;

/** Score slot (team index in team mode, player index otherwise) a contender plays for. */
export const scoreSlotOf = (game: Pick<GameState, "teams">, playerSlot: number) => teamIndexFor(game.teams, playerSlot);

/** Applies the bull-off result: the winner throws first in leg 1. Pure — returns a new state. */
export function applyBullOffWinner(game: GameState, winnerSlot: 0 | 1): GameState {
  return {
    ...game,
    currentPlayerIndex: winnerSlot,
    currentLeg: { ...game.currentLeg, startingPlayerIndex: winnerSlot },
    bullOff: { distances: game.bullOff?.distances ?? [null, null], round: game.bullOff?.round ?? 1, resolved: true, winner: winnerSlot },
  };
}
