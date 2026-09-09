/**
 * Client-side caller for the generate-match-report edge function (KI-Spielbericht) — same plain
 * `fetch` pattern Players.tsx's generateAiPortrait uses for generate-player-portrait, rather than
 * `supabase.functions.invoke`, so it's consistent with how this app already calls its other
 * AI-backed edge functions. The function does its own authorization (re-SELECTs the game under the
 * caller's own JWT before ever touching the AI gateway), so this is a thin, mostly-error-shaping
 * wrapper — see generate-match-report/index.ts for the actual logic.
 */
export async function generateMatchReport(gameId: string, language: string, accessToken: string): Promise<string> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-match-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ gameId, language }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(typeof data.error === "string" ? data.error : `Request failed (${response.status})`);
  }
  if (typeof data.report !== "string" || !data.report) {
    throw new Error("No report returned");
  }
  return data.report;
}
