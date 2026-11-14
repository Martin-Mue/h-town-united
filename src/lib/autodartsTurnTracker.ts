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
 * finished at takeout -- the very moment it replaces it with the next one. Waiting for "finished"
 * therefore never fires. Instead a visit is committed as soon as it is complete on the board (three
 * darts, a bust, or the leg/match won), and as a safety net when a new turn id shows up while the
 * previous one (last seen with darts) was never committed.
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
  const complete = current.throws.length >= 3 || current.busted || state.legFinished || state.matchFinished || state.currentTurnFinished;
  if (current.turnId !== committed && current.throws.length > 0 && complete) {
    commits.push({ turnId: current.turnId, throws: current.throws, busted: current.busted });
    return { commits, pending: [], seen: current };
  }
  return { commits, pending: current.turnId === committed ? [] : current.throws, seen: current };
}
