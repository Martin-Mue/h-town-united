/**
 * Live-KI-Kommentator (2026-09-10) — client-side caller for the live-commentary edge function.
 * Same plain `fetch` pattern matchReport.ts's generateMatchReport uses for generate-match-report,
 * for the same reason: consistent with how this app already calls its other AI-backed edge
 * functions, rather than `supabase.functions.invoke`. Deliberately swallows ALL failures into
 * `null` instead of throwing — see Game.tsx's call site: this is optional color commentary layered
 * on top of the normal round announcement, and a network hiccup or an exhausted AI quota should
 * never interrupt or error out an actual game in progress.
 */
export type CommentaryEvent = "checkout" | "180" | "ton_plus" | "bust" | "leg_win" | "match_win";

export interface LiveCommentaryParams {
  event: CommentaryEvent;
  playerName: string;
  opponentName?: string;
  roundTotal?: number;
  remaining?: number;
  mode?: string;
  accessToken: string;
}

export async function fetchLiveCommentary(params: LiveCommentaryParams): Promise<string | null> {
  const { accessToken, ...body } = params;
  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/live-commentary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error || typeof data.line !== "string" || !data.line) return null;
    return data.line;
  } catch {
    return null;
  }
}

/** Device-local on/off toggle (localStorage, same convention as utils/speech.ts's caller-voice
 *  picker) — a personal preference on TOP of the club's plan-tier gate (see planFeatures.ts's
 *  "ai-commentary" entry), not a replacement for it: even a club whose plan includes the feature
 *  shouldn't have it start talking over every player's shoulder without them opting in first. */
const AI_COMMENTARY_KEY = "ai-commentary-enabled";

export function getAiCommentaryEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AI_COMMENTARY_KEY) === "true";
}

export function setAiCommentaryEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AI_COMMENTARY_KEY, String(enabled));
}
