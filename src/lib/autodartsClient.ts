import type { DetectedDart } from "@/components/game/LiveCamera";

/**
 * Plain functions for talking to Autodarts' own cloud API directly from the client, using a
 * short-lived access token minted by the `autodarts-auth` edge function (see AutodartsLiveScore.tsx
 * for where that token comes from). Autodarts has no official public API — every URL/shape below is
 * reconstructed from real, working community client code (see the Autodarts-Integration plan for
 * sourcing), graded by confidence in the comments. Nothing here should be "corrected" by guessing
 * harder — if a call starts failing, that's a signal to re-verify against a live board, not to
 * silently change the shape.
 */

// Confirmed live 2026-09-15 from the actual Autodarts web app's own DevTools Network tab
// (GET https://api.autodarts.com/gs/v0/matches/<id>) -- .com, NOT .io. The earlier .io guess came
// from real ESP32 firmware source and was wrong here, presumably stale/superseded -- this is why
// the code favors what's freshly verified over what's merely "from a working reference".
const AUTODARTS_API_BASE = "https://api.autodarts.com";

export interface AutodartsGameConfig {
  baseScore: 301 | 501;
  doubleOut: boolean;
  legs: number;
}

async function autodartsFetch(accessToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${AUTODARTS_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Autodarts API ${path} -> ${res.status}`);
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

/**
 * Starts a private single-player "Free Game" lobby with the given X01 settings and immediately
 * starts it. Body shape and bullOffMode="Off" confirmed live 2026-09-15 from the real Autodarts web
 * app's own DevTools capture (see autodartsClient's header comment) — high confidence now, not a
 * guess. "Off" is deliberate, not just what was observed: Dartspot already decides who starts (its
 * own bull-off/starter-swap feature) before ever creating this lobby, so Autodarts' own bull-off
 * procedure would be redundant at best, conflicting at worst.
 *
 * The lobby's own `id` is reused as the match id once started (confirmed live: the exact same id
 * appeared on both the pre-start lobby object and the post-start match object) — there is no
 * separate "matchId" returned by the start call.
 */
export async function createFreeGameLobby(accessToken: string, config: AutodartsGameConfig): Promise<{ matchId: string }> {
  const lobby = (await autodartsFetch(accessToken, "/gs/v0/lobbies", {
    method: "POST",
    body: JSON.stringify({
      variant: "X01",
      isPrivate: true,
      bullOffMode: "Off",
      settings: {
        baseScore: config.baseScore,
        inMode: "Straight",
        outMode: config.doubleOut ? "Double" : "Straight",
        maxRounds: 50,
        bullMode: "25/50",
      },
      legs: config.legs,
    }),
  })) as { id?: string } | null;
  const lobbyId = lobby?.id;
  if (!lobbyId) throw new Error("Autodarts: Lobby-Erstellung lieferte keine Lobby-ID");

  await autodartsFetch(accessToken, `/gs/v0/lobbies/${lobbyId}/start`, { method: "POST" });
  return { matchId: lobbyId };
}

/** Best-effort, never-throws teardown — closing the remote lobby is a courtesy so it doesn't sit
 *  open forever, not something a finished/abandoned local game should ever wait on or fail over. */
export async function finishMatch(accessToken: string, matchId: string): Promise<void> {
  try {
    await autodartsFetch(accessToken, `/gs/v0/matches/${matchId}/finish`, { method: "POST" });
  } catch (e) {
    console.warn("autodartsClient.finishMatch failed (non-fatal)", e);
  }
}

/** Confirmed live 2026-09-15: GET /gs/v0/matches/{id} (bare, no "/state" suffix — the community doc
 *  this was originally guessed from was wrong about the path shape). */
export async function getMatchState(accessToken: string, matchId: string): Promise<unknown> {
  return autodartsFetch(accessToken, `/gs/v0/matches/${matchId}`);
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
 * Parses one `/gs/v0/matches/{id}` poll response into a small, normalized shape. Field NAMES/
 * LOCATIONS below are confirmed live (2026-09-15, real DevTools capture from the actual Autodarts
 * web app) — only the populated shape of one individual `throws[]` entry is still a guess (see
 * AutodartsPollState's own doc comment). Never throws: an unexpected shape just parses to "nothing
 * new yet" rather than crashing, which naturally counts toward AutodartsLiveScore's
 * consecutive-failure → manual-entry fallback.
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
