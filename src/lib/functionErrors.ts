/** supabase-js's FunctionsHttpError.message is just a generic "Edge Function returned a non-2xx
 *  status code" — the function's own `{ error: "..." }` JSON body (the actually useful part, e.g.
 *  "Stripe is not configured...") only lives on `error.context`, the raw Response object, and has
 *  to be read out separately. Without this, every server-side failure looked identical to callers
 *  regardless of cause — confirmed live 2026-09-03 when a real Stripe rejection was completely
 *  hidden behind the generic message. Shared (originally lived only in AdminBilling.tsx) since
 *  autodarts-auth's caller needs the identical unwrap. */
export async function describeFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
    } catch {
      // context wasn't JSON (or already consumed) — fall through to the generic message below.
    }
  }
  return error instanceof Error ? error.message : "Unbekannter Fehler.";
}
