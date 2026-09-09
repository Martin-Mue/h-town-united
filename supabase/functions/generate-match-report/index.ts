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

// Same per-user backstop shape as generate-player-portrait/analyze-dartboard, sized for "one
// report per finished match, tapped by hand" rather than a per-throw loop — generous enough for
// a heavy club night (dozens of matches) while still bounding runaway/abusive use.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30;
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

const SUPPORTED_LANGUAGES = new Set(["de", "en", "fr", "pl", "nl", "tr"]);
const LANGUAGE_NAMES: Record<string, string> = {
  de: "German", en: "English", fr: "French", pl: "Polish", nl: "Dutch", tr: "Turkish",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }

    // Bound to the CALLER's own JWT, not the service role — this is what makes the SELECT below
    // a real authorization check rather than a formality: it only succeeds for a game this user
    // can already see under the existing "Members can view all club games" RLS policy. Only the
    // later write (see the service-role client further down) needs elevated privilege, because
    // `games` has no UPDATE policy for authenticated users at all (see this function's own
    // migration's doc comment for why — ai_report is written server-side-only, like
    // apply_game_player_stats() writes games_played/average/etc. via SECURITY DEFINER instead of
    // a client UPDATE).
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

    const { gameId, language: rawLanguage } = await req.json().catch(() => ({}));
    if (!gameId || typeof gameId !== "string") {
      return jsonResponse({ error: "gameId is required" }, 400);
    }
    const language = SUPPORTED_LANGUAGES.has(rawLanguage) ? rawLanguage : "de";

    const { data: game, error: gameError } = await callerClient
      .from("games")
      .select("id, ai_report, mode, best_of_legs, best_of_sets, player1_name, player2_name, player1_average, player2_average, player1_highscore, player2_highscore, player1_double_rate, player2_double_rate, player1_legs_won, player2_legs_won, player1_sets_won, player2_sets_won, winner_name")
      .eq("id", gameId)
      .maybeSingle();
    if (gameError) {
      console.error("generate-match-report: game lookup failed", gameError);
      return jsonResponse({ error: "Could not load the match" }, 500);
    }
    if (!game) {
      return jsonResponse({ error: "Match not found or not accessible" }, 404);
    }
    // Idempotent: a report already exists (an earlier tap, or a retry after the client missed
    // the response) — hand it straight back rather than spending another AI call to regenerate
    // the same text for the same finished match.
    if (game.ai_report) {
      return jsonResponse({ report: game.ai_report, cached: true });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const isDouble = game.player2_name && game.player2_name !== "—";
    const statLines: string[] = [
      `Mode: ${game.mode}${game.best_of_sets ? `, best of ${game.best_of_sets} sets (best of ${game.best_of_legs} legs per set)` : game.best_of_legs > 1 ? `, best of ${game.best_of_legs} legs` : ""}`,
      `Winner: ${game.winner_name}`,
      `${game.player1_name}: average ${Number(game.player1_average).toFixed(1)}, highest visit ${game.player1_highscore}, checkout rate ${Number(game.player1_double_rate).toFixed(0)}%, ${game.best_of_sets ? `${game.player1_sets_won} sets won` : `${game.player1_legs_won} legs won`}`,
    ];
    if (isDouble) {
      statLines.push(`${game.player2_name}: average ${Number(game.player2_average).toFixed(1)}, highest visit ${game.player2_highscore}, checkout rate ${Number(game.player2_double_rate).toFixed(0)}%, ${game.best_of_sets ? `${game.player2_sets_won} sets won` : `${game.player2_legs_won} legs won`}`);
    }

    const systemPrompt = `You are an enthusiastic local sports journalist covering amateur darts matches at a small darts club. Given real match stats, write a short, punchy, warm recap — 2 to 4 sentences, plain prose, no markdown, no headline, no quotation marks around the whole thing. Weave the real numbers in naturally instead of just listing them. Never invent facts, names, or numbers beyond what's given. Write entirely in ${LANGUAGE_NAMES[language]}.`;
    const userPrompt = `Match stats:\n${statLines.join("\n")}\n\nWrite the recap now.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0.85,
        max_tokens: 220,
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
      console.error("generate-match-report: AI gateway error", response.status, errText);
      return jsonResponse({ error: "AI report generation failed", retryable: response.status >= 500 }, response.status);
    }

    const aiResult = await response.json();
    let report = String(aiResult.choices?.[0]?.message?.content || "").trim();
    // Defensive trim — the model is instructed to keep this short, but a hard cap avoids an
    // unbounded wall of text ever reaching the DB/UI if it ignores that instruction once.
    if (report.length > 700) report = report.slice(0, 700).trim();
    // Strip a full wrapping pair of quote marks some models add despite the system prompt saying not to.
    if (report.length > 1 && ((report[0] === '"' && report[report.length - 1] === '"') || (report[0] === "“" && report[report.length - 1] === "”"))) {
      report = report.slice(1, -1).trim();
    }
    if (!report) {
      return jsonResponse({ error: "AI returned an empty report", retryable: true }, 502);
    }

    // Elevated write: `games` has no client-facing UPDATE policy (see the migration's doc
    // comment), so this uses the service role the same way stripe-webhook does for its own
    // trusted server-side write — the SELECT above already proved this caller may see this exact
    // row, which is the authorization check that matters here.
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error: updateError } = await serviceClient.from("games").update({ ai_report: report }).eq("id", gameId);
    if (updateError) {
      // The report itself is still good — hand it back so the UI has something to show even if
      // persisting it failed, just without the "already generated" fast path on a later reload.
      console.error("generate-match-report: failed to persist ai_report", updateError);
    }

    return jsonResponse({ report });
  } catch (e) {
    console.error("generate-match-report error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
