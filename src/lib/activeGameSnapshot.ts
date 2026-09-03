import type { GameState } from "@/types/game";

export interface TournamentLink {
  tournamentId: string;
  matchId: string;
  tournamentName?: string;
  board?: number;
  // The bracket's own authoritative player1/player2 name strings, and whether player1 is
  // GameState.players[0] — always true for local/board-mode play (playerNames[0] is set straight
  // from match.player1 at launch, byte-identical), but an online-played match can have it either
  // way (whoever tapped "Online" first becomes slot 0, not necessarily the bracket's player1).
  // Optional so an old crash-recovery snapshot from before this field existed still deserializes;
  // Game.tsx's write-back falls back to game.winnerName/legsWon when absent, which was already
  // exactly correct for local play (see this field's own construction sites).
  player1Name?: string;
  player2Name?: string;
  player1IsGameSlot0?: boolean;
}

export interface ActiveGameSnapshot {
  game: GameState;
  dartsThisRound: number;
  turnStartRemaining: number;
  tournamentLink: TournamentLink | null;
}

/**
 * Crash-recovery for an in-progress match — a page reload (pull-to-refresh triggered by
 * accident, a PWA update taking over, the tab getting killed) used to lose the whole game with
 * no way back. GameState is fully self-contained (players/scores/legs/throws/mode), so the
 * whole thing can just be mirrored to localStorage while playing and restored on next load —
 * no server round-trip needed, and it's already gone the moment the leg finishes (see
 * clearActiveGameSnapshot), since a finished game is the existing save/offline-queue path's job
 * to protect, not this one's.
 *
 * Also carries dartsThisRound/turnStartRemaining/tournamentLink alongside `game` — these used to
 * live in plain, unpersisted component state, so a reload mid-visit silently reset them to their
 * defaults (0/0/null) while `game` itself came back from mid-leg. turnStartRemaining stuck at 0
 * is the confirmed mechanism behind a real report of a player's remaining suddenly jumping to 0
 * with no valid checkout: the NEXT bust on that leg reverts `remaining` to turnStartRemaining
 * (see Game.tsx's bust branch), which after an unrestored reload was 0 instead of the player's
 * real pre-visit score. tournamentLink not surviving a reload similarly left the post-game screen
 * offering a plain "new game" instead of "back to tournament", and silently dropped the bracket
 * result write on save.
 *
 * Deliberately does NOT carry a league-fixture link the same way — see Game.tsx's leagueLinkRef
 * doc comment for why that one's lighter-weight on purpose.
 */
const ACTIVE_GAME_KEY = "dartcam-active-game-v1";

/** Scoped by tournament+match when this launch is tournament-linked, falling back to the bare
 *  key for a casual game — a single global key meant two boards played from two tabs of the same
 *  browser (a realistic stopgap without one iPad per board) continuously clobbered each other's
 *  in-progress snapshot. Reads the URL directly instead of the useSearchParams hook so it also
 *  works inside loadActiveGameSnapshot's useState initializer, which runs before that hook is
 *  even called. */
function activeGameKey(): string {
  if (typeof window === "undefined") return ACTIVE_GAME_KEY;
  const params = new URLSearchParams(window.location.search);
  const tid = params.get("tid");
  const mid = params.get("mid");
  return tid && mid ? `${ACTIVE_GAME_KEY}:${tid}:${mid}` : ACTIVE_GAME_KEY;
}

export function loadActiveGameSnapshot(): ActiveGameSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(activeGameKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Snapshots written before this wrapper existed were a bare GameState (recognizable by a
    // field only GameState has) — treated as having no partial-visit/tournament-link info
    // rather than discarded outright, so upgrading doesn't lose an in-progress game.
    if (parsed && typeof parsed === "object" && "currentLeg" in parsed) {
      return { game: parsed as GameState, dartsThisRound: 0, turnStartRemaining: 0, tournamentLink: null };
    }
    const snapshot = parsed as ActiveGameSnapshot;
    // The scoped key above already keeps different matches from clobbering each other — but the
    // bare fallback key (no tid/mid in THIS url, e.g. a casual game) could still hold a
    // tournament-linked snapshot restored from a completely different, unrelated match. Discard
    // rather than resume into the wrong match's state.
    const params = new URLSearchParams(window.location.search);
    const urlTid = params.get("tid");
    const urlMid = params.get("mid");
    if (snapshot?.tournamentLink && urlTid && urlMid &&
      (snapshot.tournamentLink.tournamentId !== urlTid || snapshot.tournamentLink.matchId !== urlMid)) {
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function saveActiveGameSnapshot(snapshot: ActiveGameSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(activeGameKey(), JSON.stringify(snapshot));
  } catch {
    /* storage full/unavailable — not fatal, just no crash-recovery this session */
  }
}

export function clearActiveGameSnapshot() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(activeGameKey());
}
