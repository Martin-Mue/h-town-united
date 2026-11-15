import type { DetectedDart } from "@/components/game/LiveCamera";
import type { AutodartsBoardState, AutodartsPollState } from "@/lib/autodartsClient";

/** The current Autodarts turn as last seen by a poll. */
export interface SeenAutodartsTurn {
  turnId: string;
  throws: DetectedDart[];
  busted: boolean;
}

/** A finished visit that waits until its darts are pulled before it goes into the Dartspot game. */
export interface HeldAutodartsVisit {
  turnId: string;
  throws: DetectedDart[];
  /** Autodarts' own bust flag. Ignored once the player edited a dart -- Dartspot then decides itself. */
  busted: boolean;
  edited: boolean;
  /** Date.now() when the visit was finished. */
  heldAt: number;
}

export interface AutodartsTurnDecision {
  /** Visits that are finished on the board, oldest first (at most two: a turn missed between polls, then the current one). */
  finished: SeenAutodartsTurn[];
  /** Darts of the still-open current turn, for the live preview. */
  pending: DetectedDart[];
  pendingBusted: boolean;
  /** What to remember for the next poll. */
  seen: SeenAutodartsTurn | null;
}

/**
 * Finds the visits that are finished on the board, from one poll of GET /gs/v0/matches/{id}/state.
 *
 * Seen live (2026-11-14/15): /state only ever carries the CURRENT turn, and Autodarts moves on to the next
 * turn by itself ~3-4 s after the third dart (right after the first dart of a bust) -- darts still in the
 * board. A visit is therefore finished as soon as it is complete on the board (three darts, a bust, the
 * leg/match won), and as a safety net when a new turn id shows up while the previous one (last seen with
 * darts) was never handled. When it actually goes into the game is up to shouldReleaseHeldVisit.
 */
export function decideAutodartsTurn(
  state: AutodartsPollState,
  previous: SeenAutodartsTurn | null,
  lastHandledTurnId: string | null,
): AutodartsTurnDecision {
  // A poll without match state ({status:"pending"}: Autodarts had not answered yet) says nothing about the
  // turn. Reading it as "the turn is gone" took over visits with only the darts seen so far and lost the
  // rest (seen live 2026-11-15: 23 Autodarts visits, 22 in Dartspot, checkouts then out of step).
  if (!state.hasMatchState) {
    const open = !!previous && previous.turnId !== lastHandledTurnId;
    return { finished: [], pending: open ? previous!.throws : [], pendingBusted: open && previous!.busted, seen: previous };
  }

  const finished: SeenAutodartsTurn[] = [];
  let handled = lastHandledTurnId;

  if (previous && previous.turnId !== state.currentTurnId && previous.turnId !== handled && previous.throws.length > 0) {
    finished.push(previous);
    handled = previous.turnId;
  }

  if (!state.currentTurnId) return { finished, pending: [], pendingBusted: false, seen: null };

  const current: SeenAutodartsTurn = { turnId: state.currentTurnId, throws: state.currentTurnThrows, busted: state.currentTurnBusted };
  const complete = current.throws.length >= 3 || current.busted || state.legFinished || state.matchFinished || state.currentTurnFinished;
  if (current.turnId !== handled && current.throws.length > 0 && complete) {
    finished.push(current);
    return { finished, pending: [], pendingBusted: false, seen: current };
  }
  const open = current.turnId !== handled;
  return { finished, pending: open ? current.throws : [], pendingBusted: open && current.busted, seen: current };
}

/** Without a usable board state, a held visit goes into the game after this long anyway. */
export const HELD_VISIT_FALLBACK_MS = 20_000;

const MIN_HOLD_MS = 2_000;
const BOARD_RUNNING = new Set(["Throw", "Takeout", "Takeout in progress"]);

/**
 * Whether a held visit can go into the game now (user wish 2026-11-15: only once the darts are pulled, so
 * there is time to correct it and a bot does not start while the darts are still in the board):
 *  - the board is back to "Throw" with no darts in it (Autodarts' board manager: Throw -> Takeout ->
 *    Takeout in progress -> Throw), or
 *  - the next Autodarts turn already has darts (the player is throwing again), or
 *  - the board reports nothing usable (offline, stopped, no answer) for HELD_VISIT_FALLBACK_MS.
 */
export function shouldReleaseHeldVisit(
  held: HeldAutodartsVisit,
  board: AutodartsBoardState | null,
  current: SeenAutodartsTurn | null,
  now: number,
): boolean {
  if (current && current.turnId !== held.turnId && current.throws.length > 0) return true;
  // The first board answer after holding can still be from just before the last dart landed -- give it a moment.
  if (board && BOARD_RUNNING.has(board.status)) return board.status === "Throw" && board.numThrows === 0 && now - held.heldAt >= MIN_HOLD_MS;
  return now - held.heldAt >= HELD_VISIT_FALLBACK_MS;
}
