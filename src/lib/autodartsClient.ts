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

const AUTODARTS_API_BASE = "https://api.autodarts.io";

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
 * starts it, returning the resulting match id to poll. Body shape: medium confidence, from a
 * community API-capabilities reference, not officially documented — see the plan's "Offene Punkte".
 * If Autodarts' actual lobby-creation contract differs, this simply throws (non-2xx or missing id),
 * which AutodartsLiveScore treats as a connection failure and falls back to manual entry — it never
 * silently mis-starts a game on a wrong guess.
 */
export async function createFreeGameLobby(accessToken: string, config: AutodartsGameConfig): Promise<{ matchId: string }> {
  const lobby = (await autodartsFetch(accessToken, "/gs/v0/lobbies", {
    method: "POST",
    body: JSON.stringify({
      variant: "X01",
      isPrivate: true,
      bullOffMode: "Normal",
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

  const started = (await autodartsFetch(accessToken, `/gs/v0/lobbies/${lobbyId}/start`, { method: "POST" })) as
    | { matchId?: string; id?: string }
    | null;
  const matchId = started?.matchId ?? started?.id;
  if (!matchId) throw new Error("Autodarts: Lobby-Start lieferte keine Match-ID");
  return { matchId };
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

export async function getMatchState(accessToken: string, matchId: string): Promise<unknown> {
  return autodartsFetch(accessToken, `/gs/v0/matches/${matchId}/state`);
}

export interface AutodartsPollState {
  /** The CURRENT visit's throws so far (0-3), in order, already normalized to this app's
   *  DetectedDart shape. AutodartsLiveScore detects a completed visit purely by watching this
   *  array's length grow then reset — see its own doc comment for why that's a safer signal to
   *  depend on than guessing a "current player index" field name. */
  throwsThisTurn: DetectedDart[];
  isFinished: boolean;
}

/**
 * Bull is scored differently between systems: Autodarts is assumed (per the one community
 * reference found) to report it as segment.number 25 with a multiplier, same as this app's own
 * convention (x01Rules.ts's pointsFor: baseValue 25 + multiplier 2 = bullseye/50, never a separate
 * baseValue 50). If a live board turns out to report bullseye as number 50 instead, this is the one
 * place to fix — everything downstream already expects the 25-with-multiplier shape.
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

/**
 * Parses one `/gs/v0/matches/{id}/state` poll response into a small, normalized shape.
 * Confidence: medium (the endpoint path is corroborated across sources, the exact response body is
 * not) — this is THE one place in the whole integration where the real schema is still a guess, by
 * design, so a live-verification fix only ever has to happen here. Never throws: an unexpected
 * shape just parses to "nothing new yet" (empty throws, unchanged signature) rather than crashing,
 * which naturally counts toward AutodartsLiveScore's consecutive-failure → manual-entry fallback.
 */
export function parseAutodartsState(raw: unknown): AutodartsPollState {
  try {
    const s = (raw ?? {}) as Record<string, unknown>;
    const turnLike = s.turn as Record<string, unknown> | undefined;
    const throwsRaw = s.throws ?? turnLike?.throws ?? [];
    const throwsThisTurn = Array.isArray(throwsRaw)
      ? (throwsRaw as { segment?: { number?: number; multiplier?: number } }[]).slice(0, 3).map((t) => mapSegmentToDetectedDart(t.segment))
      : [];
    return { throwsThisTurn, isFinished: !!s.isFinished };
  } catch (e) {
    console.warn("autodartsClient.parseAutodartsState: unexpected shape", e);
    return { throwsThisTurn: [], isFinished: false };
  }
}
