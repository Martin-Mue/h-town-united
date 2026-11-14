import { supabase } from "@/integrations/supabase/client";
import type { DetectedDart } from "@/components/game/LiveCamera";
import type { Json } from "@/integrations/supabase/types";

/**
 * Client-side callers for the autodarts_session_..., autodarts_account_... and autodarts_player_login_...
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

/** Where the throws come from: the caller's own linked Autodarts account (Settings) or a club
 *  board an admin connected (Admin > Autodarts). */
export type AutodartsSource = { kind: "account" } | { kind: "board"; boardNumber: number };

/** One player of an Autodarts lobby, in throwing order. "host" = the owner of the source account
 *  (stats land in their Autodarts account), "login" = a fellow player who confirmed their own
 *  Autodarts login for this match, "guest" = scored on the same board under a plain name. */
export type AutodartsLobbyPlayer =
  | { kind: "host"; name: string }
  | { kind: "guest"; name: string }
  | { kind: "login"; name: string; login_id: string };

export interface AutodartsLegConfig {
  baseScore: number;
  doubleOut: boolean;
}

/** The open Autodarts session of one Dartspot leg (kept in the crash-recovery snapshot). */
export interface AutodartsSessionRef {
  sessionId: string;
  legKey: string;
}

export interface AutodartsSessionInfo {
  sessionId: string;
  matchId: string;
  boardName: string | null;
  warnings: string[];
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts one Autodarts lobby for one Dartspot leg and waits until it is live. The server only
 * enqueues each Autodarts call (pg_net can't see a request before the enqueuing transaction
 * commits), so this drives autodarts_session_step about once a second: tokens -> lobby -> boards ->
 * players -> start. One lobby per leg keeps Autodarts' own remaining score and starter order in
 * line with Dartspot even when a bot or a remote online opponent wins a leg.
 */
export async function startAutodartsSession(
  source: AutodartsSource,
  config: AutodartsLegConfig,
  players: AutodartsLobbyPlayer[],
  isCancelled: () => boolean = () => false,
): Promise<AutodartsSessionInfo> {
  const { data: sessionId, error } = await supabase.rpc("autodarts_session_start", {
    p_host_kind: source.kind,
    p_board_number: source.kind === "board" ? source.boardNumber : null,
    p_base_score: config.baseScore,
    p_double_out: config.doubleOut,
    p_players: players as unknown as Json,
  });
  if (error) throw new Error(error.message);
  if (!sessionId) throw new Error("Autodarts: Sitzung konnte nicht angelegt werden");

  for (let attempt = 0; attempt < 60; attempt++) {
    await wait(attempt === 0 ? 300 : 1000);
    if (isCancelled()) {
      void finishAutodartsSession(sessionId);
      throw new Error("cancelled");
    }
    const { data, error: stepError } = await supabase.rpc("autodarts_session_step", { p_session_id: sessionId });
    if (stepError) throw new Error(stepError.message);
    const result = data as { status?: string; matchId?: string; message?: string; boardName?: string; warnings?: string[] } | null;
    if (result?.status === "live" && result.matchId) {
      return { sessionId, matchId: result.matchId, boardName: result.boardName ?? null, warnings: result.warnings ?? [] };
    }
    if (result?.status === "error" || result?.status === "finished") {
      throw new Error(result.message || "Autodarts: Spielstart fehlgeschlagen");
    }
  }
  void finishAutodartsSession(sessionId);
  throw new Error("Autodarts: Spielstart dauert ungewöhnlich lange");
}

/** Best-effort, never throws: closes the Autodarts match/lobby so it doesn't stay open. */
export async function finishAutodartsSession(sessionId: string): Promise<void> {
  try {
    await supabase.rpc("autodarts_session_finish", { p_session_id: sessionId });
  } catch (e) {
    console.warn("autodartsClient.finishAutodartsSession failed (non-fatal)", e);
  }
}

/** One poll tick: the previous tick's /gs/v0/matches/{id} body, or {status:"pending"}. A failed
 *  Autodarts call comes back as {status:"error"} (the RPC never raises, so its own bookkeeping isn't
 *  rolled back) and is turned into a throw here, so the consecutive-failure fallback still works. */
export async function pollAutodartsSession(sessionId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc("autodarts_session_poll", { p_session_id: sessionId });
  if (error) throw new Error(error.message);
  const result = data as { status?: string; message?: string } | null;
  if (result?.status === "error") throw new Error(result.message || "Autodarts: Spielstand-Abfrage fehlgeschlagen");
  return data;
}

// --- Own account (Settings) -------------------------------------------------------------------

export interface AutodartsDevice {
  id: string;
  name: string;
  type: string | null;
  connected: boolean;
}

export interface AutodartsAccountState {
  status: "disconnected" | "connecting" | "connected" | "error";
  loading: boolean;
  email: string | null;
  username: string | null;
  boards: AutodartsDevice[];
  boardsUpdatedAt: string | null;
  defaultBoardId: string | null;
  lastError: string | null;
}

export async function loadAutodartsAccount(): Promise<AutodartsAccountState> {
  const { data, error } = await supabase.rpc("autodarts_account_status");
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Partial<AutodartsAccountState>;
  return {
    status: d.status ?? "disconnected",
    loading: !!d.loading,
    email: d.email ?? null,
    username: d.username ?? null,
    boards: Array.isArray(d.boards) ? d.boards : [],
    boardsUpdatedAt: d.boardsUpdatedAt ?? null,
    defaultBoardId: d.defaultBoardId ?? null,
    lastError: d.lastError ?? null,
  };
}

/** Polls autodarts_account_status until nothing is pending any more (login, token refresh, board list). */
export async function waitForAutodartsAccount(isCancelled: () => boolean = () => false): Promise<AutodartsAccountState> {
  let state = await loadAutodartsAccount();
  for (let attempt = 0; attempt < 40 && state.loading && !isCancelled(); attempt++) {
    await wait(1000);
    state = await loadAutodartsAccount();
  }
  return state;
}

export async function linkAutodartsAccount(email: string, password: string): Promise<void> {
  const { error } = await supabase.rpc("autodarts_account_link", { p_email: email, p_password: password });
  if (error) throw new Error(error.message);
}

export async function reloadAutodartsBoards(): Promise<void> {
  const { error } = await supabase.rpc("autodarts_account_reload_boards");
  if (error) throw new Error(error.message);
}

export async function setAutodartsDefaultBoard(boardId: string): Promise<void> {
  const { error } = await supabase.rpc("autodarts_account_set_board", { p_board_id: boardId });
  if (error) throw new Error(error.message);
}

export async function unlinkAutodartsAccount(): Promise<void> {
  const { error } = await supabase.rpc("autodarts_account_unlink");
  if (error) throw new Error(error.message);
}

// --- Sources for the game setup ---------------------------------------------------------------

export interface AutodartsSources {
  account: { status: string; username: string | null; boardName: string | null } | null;
  clubBoards: { id: string; boardNumber: number; label: string | null; status: string }[];
}

export async function loadAutodartsSources(): Promise<AutodartsSources> {
  const { data, error } = await supabase.rpc("autodarts_my_sources");
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Partial<AutodartsSources>;
  return { account: d.account ?? null, clubBoards: Array.isArray(d.clubBoards) ? d.clubBoards : [] };
}

// --- A fellow player confirms their own login for one match -----------------------------------

/** Logs a fellow player into Autodarts on this device for one match (12 h). Only the refresh token
 *  is kept server-side, never the password. Resolves with the login id once Autodarts accepted it. */
export async function confirmAutodartsPlayerLogin(email: string, password: string): Promise<{ loginId: string; username: string | null }> {
  const { data: loginId, error } = await supabase.rpc("autodarts_player_login_start", { p_email: email, p_password: password });
  if (error) throw new Error(error.message);
  if (!loginId) throw new Error("Autodarts-Login fehlgeschlagen");
  for (let attempt = 0; attempt < 40; attempt++) {
    await wait(1000);
    const { data, error: statusError } = await supabase.rpc("autodarts_player_login_status", { p_login_id: loginId });
    if (statusError) throw new Error(statusError.message);
    const r = data as { status?: string; username?: string | null; lastError?: string | null } | null;
    if (r?.status === "connected") return { loginId, username: r.username ?? null };
    if (r?.status === "error" || r?.status === "expired") throw new Error(r.lastError || "Autodarts-Login fehlgeschlagen");
  }
  throw new Error("Autodarts antwortet nicht -- bitte erneut versuchen");
}

export async function removeAutodartsPlayerLogin(loginId: string): Promise<void> {
  try {
    await supabase.rpc("autodarts_player_login_remove", { p_login_id: loginId });
  } catch {
    // best-effort; it expires after 12 h anyway
  }
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
export function mapSegmentToDetectedDart(segment: { number?: number; multiplier?: number; bed?: string } | undefined): DetectedDart {
  // A miss next to the board comes as bed "Outside" with multiplier 0 -- its "number" is just the
  // nearest segment, so it must count as 0, never as a single of that number.
  const rawMultiplier = typeof segment?.multiplier === "number" ? segment.multiplier : 1;
  if (!segment || rawMultiplier === 0 || segment.bed === "Outside") return { baseValue: 0, multiplier: 1, points: 0, confidence: 1 };
  const baseValue = typeof segment.number === "number" ? segment.number : 0;
  const multiplier = (rawMultiplier === 2 || rawMultiplier === 3 ? rawMultiplier : 1) as 1 | 2 | 3;
  // Points for the live preview; Game.tsx's submitDetectedRound recomputes them via pointsFor() anyway.
  return { baseValue, multiplier, points: baseValue * multiplier, confidence: 1 };
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
    const throwsRaw = Array.isArray(lastTurn?.throws) ? (lastTurn!.throws as { segment?: { number?: number; multiplier?: number; bed?: string } }[]) : [];
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
