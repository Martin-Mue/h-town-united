import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

const jsonResponse = (payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageBase64, detectBoard = false } = await req.json().catch(() => ({}));
    if (!imageBase64) {
      return jsonResponse({ ...emptyResult, error: "No image provided", status: 400, retryable: false });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `Score dartboard photos. Use the dart tip position to determine the segment; ignore shaft and flight unless needed to locate the tip.
If a dart is partially occluded, follow the visible tip end and shaft direction to infer the exact segment.
Return only JSON. Count only darts currently stuck in the board. If uncertain, omit the dart.
Scoring: single=segment, double=2x, triple=3x, bull 25, bullseye 50, miss=0. Include x,y coordinates (0-1 relative) for each dart tip.
Return:
{"board":{"cx":0.5,"cy":0.5,"size":0.78,"confidence":0.92},"darts":[{"segment":20,"multiplier":3,"points":60,"confidence":0.9,"x":0.5,"y":0.2}],"totalScore":60,"overallConfidence":0.8,"dartsDetected":1}
If no darts are visible, return darts=[], totalScore=0, overallConfidence=0, dartsDetected=0 and include board if visible. If no dartboard is visible, set board=null.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0,
        max_tokens: 240,
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
                text: detectBoard
                  ? "Find the board center and size. If darts are visible, include them. Return only JSON."
                  : "Identify all darts currently stuck in the board. Use dart tips for the score. Return only JSON.",
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
    const content = aiResult.choices?.[0]?.message?.content || "";

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
