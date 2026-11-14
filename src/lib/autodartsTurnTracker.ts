import type { DetectedDart } from "@/components/game/LiveCamera";
import type { AutodartsPollState } from "@/lib/autodartsClient";

/** The current Autodarts turn as last seen by a poll. */
export interface SeenAutodartsTurn {
  turnId: string;
  throws: DetectedDart[];
  busted: boolean;
}

export interface AutodartsTurnDecision {
  /** Visits to hand to Dartspot, oldest first (at most two: a turn missed between polls, then the current one). */
  commits: { turnId: string; throws: DetectedDart[]; busted: boolean }[];
  /** Darts of the still-open current turn, for the live preview (empty once committed). */
  pending: DetectedDart[];
  /** What to remember for the next poll. */
  seen: SeenAutodartsTurn | null;
}

/**
 * Decides which Autodarts visits to commit, from one poll of GET /gs/v0/matches/{id}/state.
 *
 * Seen live (2026-11-14): /state only ever carries the CURRENT turn, and Autodarts only marks a turn
 * finished at takeout -- the very moment it replaces it with the next one, so "finished" itself is
 * hardly ever seen. A visit is therefore committed when the darts are pulled: a new turn id shows up
 * while the previous one (last seen with darts) was never committed. Until then its darts stay a
 * pending preview -- so a bot only starts throwing once the board is clear (user wish 2026-11-14).
 * A won leg/match is committed right away: there is no next turn to wait for.
 */
export function decideAutodartsTurn(
  state: AutodartsPollState,
  previous: SeenAutodartsTurn | null,
  lastCommittedTurnId: string | null,
): AutodartsTurnDecision {
  const commits: AutodartsTurnDecision["commits"] = [];
  let committed = lastCommittedTurnId;

  if (previous && previous.turnId !== state.currentTurnId && previous.turnId !== committed && previous.throws.length > 0) {
    commits.push({ turnId: previous.turnId, throws: previous.throws, busted: previous.busted });
    committed = previous.turnId;
  }

  if (!state.currentTurnId) return { commits, pending: [], seen: null };

  const current: SeenAutodartsTurn = { turnId: state.currentTurnId, throws: state.currentTurnThrows, busted: state.currentTurnBusted };
  const complete = state.legFinished || state.matchFinished || state.currentTurnFinished;
  if (current.turnId !== committed && current.throws.length > 0 && complete) {
    commits.push({ turnId: current.turnId, throws: current.throws, busted: current.busted });
    return { commits, pending: [], seen: current };
  }
  return { commits, pending: current.turnId === committed ? [] : current.throws, seen: current };
}
