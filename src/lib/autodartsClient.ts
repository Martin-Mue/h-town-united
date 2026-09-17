import { supabase } from "@/integrations/supabase/client";
import type { DetectedDart } from "@/components/game/LiveCamera";

/**
 * Client-side callers for the autodarts_start_match/autodarts_poll_match/autodarts_finish_match
 * Postgres RPCs (see the matching migration) -- NOT direct calls to Autodarts' own API. A live CORS
 * probe (2026-09-15, from this app's own deployed origin) confirmed api.autodarts.com restricts
 * every endpoint -- not just the login one -- to Origin/Referer https://play.autodarts.com, so a
 * browser can never call it directly regardless of how a valid access token was obtained. Every
 * Autodarts call, including ordinary match-state polling, has to be proxied through
 * Postgres+pg_net, which isn't subject to browser CORS at all (server-to-server). Net effect: the
 * Autodarts access token itself never reaches this client anymore, for anything.
 *
 * Autodarts has no official public API -- every URL/field name referenced in the underlying
 * Postgres functions was reconstructed from real, live DevTools captures of the actual Autodarts
 * web app (see the Autodarts-Integration plan and the migrations' own comments for sourcing and
 * confidence level per field).
 */

export interface AutodartsGameConfig {
  baseScore: 301 | 501;
  doubleOut: boolean;
  legs: number;
}

/** Starts a private single-player "Free Game" lobby with the given X01 settings and immediately
 *  starts it, server-side. autodarts_start_match itself only ENQUEUES the first step and returns
 *  right away -- it can't synchronously wait on pg_net's background worker from within its own
 *  transaction (that request would be invisible to the worker until the transaction commits, so
 *  polling for it inside the same call can never succeed -- confirmed against pg_net's own
 *  documented behavior, and the actual root cause of a full day of mysterious "Status timeout"
 *  failures across every endpoint this integration touches). Real progress happens via repeated
 *  calls to autodarts_check_start_match_status, exactly the same enqueue-then-poll-separately
 *  pattern autodarts_connect_board/autodarts_check_connect_status already used correctly. */
export async function createFreeGameLobby(boardNumber: number, config: AutodartsGameConfig): Promise<{ matchId: string }> {
  const { error: startError } = await supabase.rpc("autodarts_start_match", {
    p_board_number: boardNumber,
    p_base_score: config.baseScore,
    p_double_out: config.doubleOut,
    p_legs: config.legs,
  });
  if (startError) throw new Error(startError.message);

  // Each real step (token refresh, lobby create, device lookup, lobby start) is its own pg_net
  // round-trip, resolved on a separate poll tick -- a handful of quick steps land well inside this
  // window in practice, but a slow Autodarts response on any one step can still eat several ticks.
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const { data, error } = await supabase.rpc("autodarts_check_start_match_status", { p_board_number: boardNumber });
    if (error) throw new Error(error.message);
    const result = data as { status?: string; matchId?: string; message?: string; step?: string } | null;
    if (result?.status === "connected") {
      if (!result.matchId) throw new Error("Autodarts: Lobby-Erstellung lieferte keine Match-ID");
      return { matchId: result.matchId };
    }
    if (result?.status === "error") {
      console.warn("autodartsClient.createFreeGameLobby: server-reported failure", result);
      throw new Error(result.message || "Autodarts: Lobby-Erstellung fehlgeschlagen");
    }
    // status === "pending" -- still working through the steps, keep polling.
  }
  throw new Error("Autodarts: Lobby-Erstellung dauert ungewöhnlich lange");
}

/** Best-effort, never-throws teardown -- closing the remote lobby is a courtesy so it doesn't sit
 *  open forever, not something a finished/abandoned local game should ever wait on or fail over.
 *  The RPC itself already swallows its own failures; this wraps the call too in case the RPC
 *  invocation itself (network hiccup to Supabase, say) fails. */
export async function finishMatch(boardNumber: number, matchId: string): Promise<void> {
  try {
    await supabase.rpc("autodarts_finish_match", { p_board_number: boardNumber, p_match_id: matchId });
  } catch (e) {
    console.warn("autodartsClient.finishMatch failed (non-fatal)", e);
  }
}

export async function getMatchState(boardNumber: number, matchId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc("autodarts_poll_match", { p_board_number: boardNumber, p_match_id: matchId });
  if (error) throw new Error(error.message);
  return data;
}

export interface AutodartsPollState {
  /** Confirmed live field `turns[last].id` — a stable per-turn identifier. AutodartsLiveScore keys
   *  its "have I already committed this turn" tracking off THIS, not off player index or throw
   *  count, since turn identity is the one thing that can't be ambiguous across polls. */
  currentTurnId: string | null;
  /** Confirmed live field `player` — index into the match's `players[]`, NOT a Dartspot player
   *  index. Currently unused by AutodartsLiveScore (turn id is the more reliable signal) but kept
   *  for debugging/future use. */
  currentPlayerIndex: number | null;
  /** Confirmed live field `gameScores` — remaining X01 points per player index. Used as a
   *  cross-check on the individual-dart mapping below: the two must always agree on the total
   *  points scored this turn, since the darts are still a real-schema guess but this isn't. */
  gameScores: number[];
  /** Confirmed live fields `gameFinished` (this leg) / `finished` (whole match). */
  legFinished: boolean;
  matchFinished: boolean;
  /** The most recent turn's darts so far, mapped to this app's DetectedDart shape. Confirmed live:
   *  each match has a `turns[]` array, each turn has `busted`/`finishedAt`/`throws[]` — but `throws`
   *  was still empty in the one live capture available (no dart had landed yet), so the shape of a
   *  POPULATED throw entry (segment/multiplier field names) is the one remaining guess in this
   *  whole file. See mapSegmentToDetectedDart's own doc comment.
   *  https://api.autodarts.com/gs/v0/matches/<id> */
  currentTurnThrows: DetectedDart[];
  /** Confirmed live field `turns[last].busted`. */
  currentTurnBusted: boolean;
  /** Confirmed live field `turns[last].finishedAt` — a real timestamp once the turn is done, or the
   *  Go/.NET zero-value "0001-01-01T00:00:00Z" while still in progress. More reliable than inferring
   *  "turn done" from throw count, since it's the server's own explicit signal. */
  currentTurnFinished: boolean;
}

/**
 * Bull is scored differently between systems: Autodarts is assumed (per community reference, NOT
 * yet confirmed live — see AutodartsPollState.currentTurnThrows) to report it as segment.number 25
 * with a multiplier, same as this app's own convention (x01Rules.ts's pointsFor: baseValue 25 +
 * multiplier 2 = bullseye/50, never a separate baseValue 50). If a live board turns out to report
 * bullseye as number 50 instead, this is the one place to fix — everything downstream already
 * expects the 25-with-multiplier shape.
 */
function mapSegmentToDetectedDart(segment: { number?: number; multiplier?: number } | undefined): DetectedDart {
  const baseValue = typeof segment?.number === "number" ? segment.number : 0;
  const rawMultiplier = typeof segment?.multiplier === "number" ? segment.multiplier : 1;
  const multiplier = (rawMultiplier === 2 || rawMultiplier === 3 ? rawMultiplier : 1) as 1 | 2 | 3;
  // points is recomputed by Game.tsx's submitDetectedRound via pointsFor() and never trusted from
  // the dart itself (confirmed in LiveCamera's own contract) — 0 here is a deliberate placeholder,
  // not a guess that needs to be "right".
  return { baseValue, multiplier, points: 0, confidence: 1 };
}

const ZERO_DATE_PREFIX = "0001-01-01";

/**
 * Parses one `autodarts_poll_match` response (Autodarts' raw `/gs/v0/matches/{id}` body, passed
 * through unchanged by the RPC) into a small, normalized shape. Field NAMES/LOCATIONS below are
 * confirmed live (2026-09-15, real DevTools capture from the actual Autodarts web app) — only the
 * populated shape of one individual `throws[]` entry is still a guess (see AutodartsPollState's own
 * doc comment). Never throws: an unexpected shape just parses to "nothing new yet" rather than
 * crashing, which naturally counts toward AutodartsLiveScore's consecutive-failure → manual-entry
 * fallback.
 */
export function parseAutodartsState(raw: unknown): AutodartsPollState {
  try {
    const s = (raw ?? {}) as Record<string, unknown>;
    const turns = Array.isArray(s.turns) ? (s.turns as Record<string, unknown>[]) : [];
    const lastTurn = turns[turns.length - 1] as Record<string, unknown> | undefined;
    const throwsRaw = Array.isArray(lastTurn?.throws) ? (lastTurn!.throws as { segment?: { number?: number; multiplier?: number } }[]) : [];
    return {
      currentTurnId: typeof lastTurn?.id === "string" ? (lastTurn.id as string) : null,
      currentPlayerIndex: typeof s.player === "number" ? s.player : null,
      gameScores: Array.isArray(s.gameScores) ? (s.gameScores as unknown[]).filter((n): n is number => typeof n === "number") : [],
      legFinished: !!s.gameFinished,
      matchFinished: !!s.finished,
      currentTurnThrows: throwsRaw.slice(0, 3).map((t) => mapSegmentToDetectedDart(t.segment)),
      currentTurnBusted: !!lastTurn?.busted,
      currentTurnFinished: !(typeof lastTurn?.finishedAt === "string" && (lastTurn.finishedAt as string).startsWith(ZERO_DATE_PREFIX)),
    };
  } catch (e) {
    console.warn("autodartsClient.parseAutodartsState: unexpected shape", e);
    return {
      currentTurnId: null,
      currentPlayerIndex: null,
      gameScores: [],
      legFinished: false,
      matchFinished: false,
      currentTurnThrows: [],
      currentTurnBusted: false,
      currentTurnFinished: false,
    };
  }
}
