import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageBase64 } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "No image provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are a professional darts scoring AI. You analyze photos of a dartboard with darts in it.

Your task: Identify exactly where each dart has landed on the board and return the scores.

Rules:
- A standard dartboard has numbers 1-20 around the ring, plus single bull (25) and double bull/bullseye (50).
- Single: The large single area scores the number value.
- Double: The thin outer ring scores double the number.
- Triple: The thin inner ring scores triple the number.
- Single Bull (outer bull): 25 points.
- Double Bull (inner bull/bullseye): 50 points.
- Miss: Dart not in the board or in the non-scoring black area outside doubles ring = 0 points.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "darts": [
    { "segment": 20, "multiplier": 3, "points": 60, "confidence": 0.9 },
    { "segment": 1, "multiplier": 1, "points": 1, "confidence": 0.7 },
    { "segment": 25, "multiplier": 2, "points": 50, "confidence": 0.8 }
  ],
  "totalScore": 111,
  "overallConfidence": 0.8,
  "dartsDetected": 3
}

- segment: The board number (1-20, 25 for bull)
- multiplier: 1=single, 2=double, 3=triple (bull 25 with multiplier 2 = 50 = bullseye)
- confidence: Your confidence for each dart (0.0-1.0)
- If you cannot detect any darts, return: { "darts": [], "totalScore": 0, "overallConfidence": 0, "dartsDetected": 0, "error": "No darts detected" }
- If the image is not a dartboard, return: { "darts": [], "totalScore": 0, "overallConfidence": 0, "dartsDetected": 0, "error": "No dartboard detected" }`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
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
                text: "Analyze this dartboard image. Identify all darts and their exact positions/scores. Return the JSON result.",
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please top up." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      throw new Error("AI analysis failed");
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
      parsed = { darts: [], totalScore: 0, overallConfidence: 0, dartsDetected: 0, error: "Could not parse AI response" };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-dartboard error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
