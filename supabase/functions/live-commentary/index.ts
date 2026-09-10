import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Live-KI-Kommentator (2026-09-10): one short spoken-style line per NOTEWORTHY moment during a
// camera-scored leg (checkout, 180, ton-plus, bust, leg/match win — never every routine round,
// see Game.tsx's own gating before this is ever called), read aloud client-side via
// utils/speech.ts's speakText() right after the normal round announcement finishes. This function
// is deliberately stateless — nothing is written back to `games`, there's no report to cache —
// so it's a much thinner sibling of generate-match-report/index.ts, reusing that function's exact
// free-tier-first-then-Gateway pattern (see callGeminiDirect's own doc comment there for the full
// reasoning) but tuned for a much shorter, punchier line and a higher per-user rate budget, since
// a single evening of camera-scored darts can easily trigger this dozens of times.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 90;
const RATE_WINDOW_MS = 60 * 60 * 1000;
function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

type CommentaryEvent = "checkout" | "180" | "ton_plus" | "bust" | "leg_win" | "match_win";
const VALID_EVENTS = new Set<CommentaryEvent>(["checkout", "180", "ton_plus", "bust", "leg_win", "match_win"]);

const EVENT_HINTS: Record<CommentaryEvent, string> = {
  checkout: "The player just checked out (finished the leg with a perfect double/finish).",
  "180": "The player just scored the maximum possible visit: 180 (three triple 20s).",
  ton_plus: "The player just scored a very high visit (over 100 points, but not the max).",
  bust: "The player just busted — their visit went over the remaining score or left an impossible finish, so none of it counts.",
  leg_win: "The player just won the leg.",
  match_win: "The player just won the entire match.",
};

/** Same direct-Gemini-first pattern as generate-match-report/index.ts's callGeminiDirect — see
 *  that function's own doc comment for the full reasoning (free tier tried first, silently falls
 *  back to the paid Gateway on ANY failure, never throws). Tuned down here: far fewer output
 *  tokens (a commentary line is one short sentence, not a recap paragraph) and a higher
 *  temperature (variety matters more than for a match report — the same event repeating with the
 *  same line reads as a broken feature, not a caller). */
async function callGeminiDirect(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const key = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 1.05, maxOutputTokens: 60 },
      }),
    });
    if (!res.ok) {
      console.warn("live-commentary: direct Gemini call failed, falling back to Lovable AI Gateway", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text || "")
      .join("");
    return text.trim() || null;
  } catch (e) {
    console.warn("live-commentary: direct Gemini call threw, falling back to Lovable AI Gateway", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }
    // No DB row this call is authorized against (unlike generate-match-report) — the JWT check
    // alone is enough here, since this never reads or writes anything club/game-specific, it just
    // proves the caller is a signed-in user for the rate limiter's sake.
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: claimsData, error: claimsError } = await callerClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claimsData?.claims) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }
    const callerId = claimsData.claims.sub as string;
    if (isRateLimited(callerId)) {
      return jsonResponse({ error: "Rate limit exceeded. Please wait a moment.", retryable: true }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const { event, playerName, opponentName, roundTotal, remaining, mode } = body as {
      event?: string; playerName?: string; opponentName?: string; roundTotal?: number; remaining?: number; mode?: string;
    };
    if (!event || !VALID_EVENTS.has(event as CommentaryEvent) || !playerName || typeof playerName !== "string") {
      return jsonResponse({ error: "event and playerName are required" }, 400);
    }
    const safePlayerName = playerName.slice(0, 60);
    const safeOpponentName = typeof opponentName === "string" ? opponentName.slice(0, 60) : undefined;

    const factLines = [
      EVENT_HINTS[event as CommentaryEvent],
      `Player: ${safePlayerName}`,
      safeOpponentName ? `Opponent: ${safeOpponentName}` : null,
      typeof roundTotal === "number" ? `Points scored this visit: ${roundTotal}` : null,
      typeof remaining === "number" ? `Points the player has left to finish the leg: ${remaining}` : null,
      mode ? `Game mode: ${mode}` : null,
    ].filter(Boolean);

    // German-only for now — utils/speech.ts's TTS pipeline only actively supports "de-DE" voices
    // (see its own doc comment on pickGermanVoice), so a commentary line in any other language
    // would just get read with a mismatched voice. Revisit together if/when speech.ts ever grows
    // real multi-language TTS.
    const systemPrompt = `You are a colorful, enthusiastic LIVE darts commentator at a small amateur club, reacting in real time to what JUST happened. Write exactly ONE short spoken sentence in German (max ~12 words) — no stage directions, no quotation marks, no emoji, no markdown, nothing but the spoken line itself. Be punchy and varied — never reuse a stock phrase two events in a row. React specifically to what's described, don't just restate the numbers mechanically.`;
    const userPrompt = `${factLines.join("\n")}\n\nGive your one-line reaction now.`;

    let rawLine = await callGeminiDirect(systemPrompt, userPrompt);

    if (!rawLine) {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          temperature: 1.05,
          max_tokens: 60,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        if (response.status === 429) {
          return jsonResponse({ error: "Rate limit exceeded. Please wait a moment.", retryable: true }, 429);
        }
        if (response.status === 402) {
          return jsonResponse({ error: "AI credits exhausted. Please top up.", retryable: false }, 402);
        }
        console.error("live-commentary: AI gateway error", response.status, errText);
        return jsonResponse({ error: "Commentary generation failed", retryable: response.status >= 500 }, response.status);
      }

      const aiResult = await response.json();
      rawLine = String(aiResult.choices?.[0]?.message?.content || "").trim();
    }

    let line = (rawLine ?? "").trim();
    // A live one-liner has no business being long — cap hard rather than trust the model to
    // always respect "max ~12 words", same defensive spirit as generate-match-report's 700-char cap.
    if (line.length > 160) line = line.slice(0, 160).trim();
    if (line.length > 1 && ((line[0] === '"' && line[line.length - 1] === '"') || (line[0] === "“" && line[line.length - 1] === "”"))) {
      line = line.slice(1, -1).trim();
    }
    if (!line) {
      return jsonResponse({ error: "AI returned an empty line", retryable: true }, 502);
    }

    return jsonResponse({ line });
  } catch (e) {
    console.error("live-commentary error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
