import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const emptyResult = {
  board: null,
  darts: [],
  totalScore: 0,
  overallConfidence: 0,
  dartsDetected: 0,
};

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// This is the one AI-metered function a live camera session calls repeatedly (once per
// detected round), so the cap is generous — it's a backstop against a runaway client loop
// or outside abuse, not normal-usage throttling. Unlike generate-player-portrait/send-push,
// this one had NO auth check at all until now — anyone who found the function URL could
// burn through the shared AI credit balance without ever opening the app.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 300;
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

/** "data:image/jpeg;base64,AAAA..." -> { mimeType: "image/jpeg", data: "AAAA..." } — Google's
 *  direct Gemini API wants mime type and raw base64 as separate fields (inline_data), unlike the
 *  Lovable Gateway's OpenAI-style image_url.url which takes the whole data: URI as one string.
 *  Falls back to image/jpeg + the input as-is if it isn't already a data: URI (mirrors this same
 *  file's existing fallback for the Gateway path just below). */
function splitDataUrl(imageBase64: string): { mimeType: string; data: string } {
  const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (match) return { mimeType: match[1], data: match[2] };
  return { mimeType: "image/jpeg", data: imageBase64 };
}

/** Direct call to Google's own Gemini API using a free-tier API key (GOOGLE_AI_API_KEY secret) —
 *  this is THE highest-volume AI call in the whole app (once per detected round during live-camera
 *  play, easily dozens of calls per match), so it's also where moving cost off the paid Lovable AI
 *  Gateway matters most. Tried first, but never allowed to be a reliability regression: returns
 *  null (never throws) on any failure — no key configured, free-tier quota hit mid-match, network
 *  error, empty response — so the caller falls straight through to the existing, already-proven
 *  Gateway path below exactly as before this existed. A live scoring session must never stall just
 *  because the free tier ran out for the day. */
async function callGeminiVisionDirect(systemPrompt: string, instructionText: string, imageBase64: string): Promise<string | null> {
  const key = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!key) return null;
  try {
    const { mimeType, data } = splitDataUrl(imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{
          role: "user",
          parts: [
            { text: instructionText },
            { inline_data: { mime_type: mimeType, data } },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 600 },
      }),
    });
    if (!res.ok) {
      console.warn("analyze-dartboard: direct Gemini call failed, falling back to Lovable AI Gateway", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data2 = await res.json();
    const text = (data2.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text || "")
      .join("");
    return text.trim() || null;
  } catch (e) {
    console.warn("analyze-dartboard: direct Gemini call threw, falling back to Lovable AI Gateway", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ ...emptyResult, error: "Authentication required", status: 401, retryable: false }, 401);
    }
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claimsData?.claims) {
      return jsonResponse({ ...emptyResult, error: "Authentication required", status: 401, retryable: false }, 401);
    }
    const callerId = claimsData.claims.sub as string;
    if (isRateLimited(callerId)) {
      return jsonResponse({ ...emptyResult, error: "Rate limit exceeded. Please wait a moment.", status: 429, retryable: true }, 429);
    }

    const { imageBase64, detectBoard = false } = await req.json().catch(() => ({}));
    if (!imageBase64) {
      return jsonResponse({ ...emptyResult, error: "No image provided", status: 400, retryable: false });
    }

    const systemPrompt = `You score dartboard photos. Return ONLY JSON.

Your #1 job: find EVERY dart currently stuck in the board. Look carefully at the whole
board surface — darts can be thin, at odd angles, partially hidden behind other darts,
or near the wire/edge where they're easy to miss. It is much worse to miss a dart than
to be slightly unsure of its exact score, so report every dart you can see, even ones
you are only moderately confident about (use the confidence field for that — do not
simply omit a dart because you're unsure).

CRITICAL RULE — DART TIP:
A dart consists of TIP (metal point stuck IN the board) → BARREL → SHAFT → FLIGHT.
The score is determined by where the TIP enters the board — NEVER by where the barrel, shaft or flight visually overlaps.
Because darts stick out at an angle, the shaft/flight often visually cover a different segment than the tip.
Trace the dart from the flight along the barrel down to the tip, and score the segment the TIP is embedded in.
If the tip is fully occluded, extrapolate the tip position from the shaft direction — still report the dart with your best-estimate x,y and a lower confidence, rather than leaving it out.

Only count darts currently stuck in the board (ignore darts on the floor, in a hand, or bounced out).
Scoring: single=segment, double=2x (outer thin ring), triple=3x (inner thin ring), bull=25, bullseye=50, miss=0.
For each dart include x,y coordinates (0..1, image-relative) of the TIP location — your best estimate even if imperfect.

Return exactly this shape:
{"board":{"cx":0.5,"cy":0.5,"size":0.78,"confidence":0.92},"darts":[{"segment":20,"multiplier":3,"points":60,"confidence":0.9,"x":0.5,"y":0.2}],"totalScore":60,"overallConfidence":0.8,"dartsDetected":1}

If — and only if — there is truly no dart anywhere on the board, return darts=[], totalScore=0, overallConfidence=0, dartsDetected=0 (still include board if visible).
If no dartboard is visible, set board=null.`;

    const instructionText = detectBoard
      ? "Find the board center and size. If darts are visible, include them. Return only JSON."
      : "Identify all darts currently stuck in the board. Use dart tips for the score. Return only JSON.";

    // Free tier first (see callGeminiVisionDirect's own doc comment) — only reaches the paid
    // Gateway below when that returned null (no key configured, quota hit, or any other failure).
    // Coalesced to "" (never null) up front so every use of `content` below — including inside
    // the `if (!content)` check itself — stays a plain string with no null-narrowing to reason
    // about, whether it ends up set here or by the Gateway fallback right after.
    let content: string = (await callGeminiVisionDirect(systemPrompt, instructionText, imageBase64)) ?? "";

    if (!content) {
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
          temperature: 0,
          max_tokens: 600,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: imageBase64.startsWith("data:")
                      ? imageBase64
                      : `data:image/jpeg;base64,${imageBase64}`,
                  },
                },
                {
                  type: "text",
                  text: instructionText,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        if (response.status === 429) {
          return jsonResponse({
            ...emptyResult,
            error: "Rate limit exceeded. Please wait a moment.",
            status: 429,
            retryable: true,
            providerStatus: response.status,
            providerError: errText,
          });
        }
        if (response.status === 402) {
          return jsonResponse({
            ...emptyResult,
            error: "AI credits exhausted. Please top up.",
            status: 402,
            retryable: false,
            providerStatus: response.status,
            providerError: errText,
          });
        }
        console.error("AI error:", response.status, errText);
        return jsonResponse({
          ...emptyResult,
          error: "AI analysis failed",
          status: response.status,
          retryable: response.status >= 500,
          providerStatus: response.status,
          providerError: errText,
        });
      }

      const aiResult = await response.json();
      content = aiResult.choices?.[0]?.message?.content || "";
    }

    // Parse JSON from response (strip markdown if present)
    let parsed;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON in response");
      }
    } catch {
      console.error("Failed to parse AI response:", content);
      return jsonResponse({
        ...emptyResult,
        error: "Could not parse AI response",
        status: 502,
        retryable: true,
        rawContentPreview: content.slice(0, 300),
      });
    }

    if (!parsed.board && detectBoard) {
      parsed.board = { cx: 0.5, cy: 0.5, size: 0.75, confidence: 0.2 };
    }

    return jsonResponse(parsed);
  } catch (e) {
    console.error("analyze-dartboard error:", e);
    return jsonResponse({
      ...emptyResult,
      error: e instanceof Error ? e.message : "Unknown error",
      status: 500,
      retryable: true,
    });
  }
});
