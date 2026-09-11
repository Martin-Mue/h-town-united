import type { TeamSlot } from "@/types/game";
import { teamIndexFor } from "./teamUtils";

export type RoundCapOutcome =
  | { kind: "tied"; tiedIndexes: number[] }
  | { kind: "winner"; legWinner: number }
  | null;

/**
 * Resolves the `maxRoundsX01` "everyone's played their round-limit" cap: once every score slot
 * has completed at least `cap` rounds, the leg ends by lowest remaining score — tied, or with a
 * single winner. Deliberately takes `roundsPerPlayer`/`remaining` as plain arrays rather than a
 * GameState/LegState itself: Game.tsx's two callers need them computed two different ways —
 * handleX01Throw needs them PROJECTED (the dart just thrown, before it's actually committed to
 * React state, since the check runs against the still-stale `game` closure) while
 * submitDetectedRound already has them applied to its own local `curGame` copy and can read them
 * straight off it. Only the cap-resolution math below was ever actually duplicated between the
 * two — and that duplication is exactly why the round-cap check went missing from the camera path
 * entirely for a while (see submitDetectedRound's own history comment) before someone hand-copied
 * it back in instead of the two sharing one implementation. This function is that shared
 * implementation, called from both places with each one's own already-computed inputs.
 */
export function resolveRoundCap(
  cap: number | undefined,
  roundsPerPlayer: number[],
  remaining: number[],
  teams: TeamSlot[] | undefined,
): RoundCapOutcome {
  if (!cap || cap <= 0) return null;
  const scoreSlotRounds = remaining.map((_, si) =>
    Math.max(...roundsPerPlayer.filter((_, i) => teamIndexFor(teams, i) === si))
  );
  if (!scoreSlotRounds.every((r) => r >= cap)) return null;
  const minRemaining = Math.min(...remaining);
  const tied = remaining.reduce<number[]>((acc, r, i) => (r === minRemaining ? [...acc, i] : acc), []);
  return tied.length > 1 ? { kind: "tied", tiedIndexes: tied } : { kind: "winner", legWinner: tied[0] };
}
