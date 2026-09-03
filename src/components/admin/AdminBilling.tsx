import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

/** supabase-js's FunctionsHttpError.message is just a generic "Edge Function returned a non-2xx
 *  status code" — the function's own `{ error: "..." }` JSON body (the actually useful part,
 *  e.g. "Stripe is not configured...") only lives on `error.context`, the raw Response object,
 *  and has to be read out separately. Without this, every server-side failure here looked
 *  identical in the toast regardless of cause — confirmed live 2026-09-03 when a real Stripe
 *  rejection was completely hidden behind the generic message. */
async function describeFunctionError(error: unknown): Promise<string> {
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

/** Kept in sync with the two live Stripe prices by hand (STRIPE_PRICE_ID_MONTHLY/_YEARLY on the
 *  create-checkout-session edge function) — there's no third place this reads from, so if either
 *  price ever changes in the Stripe Dashboard, update the number here too. */
const PRICE_DISPLAY = {
  monthly: "7,99 € / Monat",
  yearly: "80,00 € / Jahr",
} as const;

/** Admin-only billing status + upgrade entry point. German-only, matching the rest of Admin.tsx;
 *  Admin.tsx's own page-level admin gate is the only access check, nothing re-checked here (same
 *  convention as AdminClubBranding/AdminInvites). The actual plan_tier/plan_status flip never
 *  happens client-side — this only ever starts a Stripe Checkout session (create-checkout-session
 *  edge function) and reflects whatever the webhook has already written; refetch() below (once
 *  back from Checkout, via the ?upgraded=1 return URL) is what picks that up, not a value set
 *  here. */
const AdminBilling = () => {
  const { toast } = useToast();
  const { club, refetch } = useClubBranding();
  const [searchParams, setSearchParams] = useSearchParams();
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");

  // Webhook writes plan_tier/plan_status asynchronously (Stripe calls it, not this tab) — by the
  // time Checkout redirects back here it's USUALLY already landed, but not guaranteed instantly,
  // so this refetches rather than trusting the redirect alone. Strips the query param either way
  // so a manual page reload afterward doesn't refetch again for no reason.
  useEffect(() => {
    if (searchParams.get("upgraded") !== "1") return;
    refetch();
    const next = new URLSearchParams(searchParams);
    next.delete("upgraded");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const startUpgrade = async () => {
    setStartingCheckout(true);
    try {
      const returnUrl = `${window.location.origin}/admin`;
      const { data, error } = await supabase.functions.invoke("create-checkout-session", {
        body: { successUrl: `${returnUrl}?upgraded=1`, cancelUrl: returnUrl, period },
      });
      if (error) throw new Error(await describeFunctionError(error));
      if (!data?.url) throw new Error("Keine Checkout-URL erhalten.");
      window.location.href = data.url;
    } catch (err) {
      toast({
        title: "Upgrade konnte nicht gestartet werden",
        description: err instanceof Error ? err.message : "Unbekannter Fehler.",
        variant: "destructive",
      });
      setStartingCheckout(false);
    }
  };

  if (!club) return null;

  if (club.plan_tier === "free_locked") {
    return (
      <div className="bg-card border border-border rounded-xl p-6 flex items-center gap-3">
        <CheckCircle2 className="w-6 h-6 text-secondary shrink-0" />
        <div>
          <p className="font-semibold text-sm">Kostenlos &amp; uneingeschränkt</p>
          <p className="text-xs text-muted-foreground mt-0.5">Dieser Verein hat dauerhaft vollen Funktionsumfang.</p>
        </div>
      </div>
    );
  }

  if (club.plan_tier === "paid") {
    const pastDue = club.plan_status === "past_due";
    return (
      <div className="bg-card border border-border rounded-xl p-6 flex items-center gap-3">
        {pastDue ? <AlertTriangle className="w-6 h-6 text-accent shrink-0" /> : <CheckCircle2 className="w-6 h-6 text-secondary shrink-0" />}
        <div>
          <p className="font-semibold text-sm">{pastDue ? "Zahlung ausstehend" : "Paid-Plan aktiv"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pastDue
              ? "Die letzte Abbuchung ist fehlgeschlagen — bitte Zahlungsmethode bei Stripe aktualisieren, sonst wird der Verein bald auf Trial zurückgestuft."
              : "Kamera-Scoring und große Turniere sind freigeschaltet."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center gap-2 mb-3">
        <CreditCard className="w-5 h-5 text-primary" />
        <p className="font-semibold text-sm">Trial-Plan</p>
      </div>
      <ul className="text-xs text-muted-foreground space-y-1 mb-4 list-disc list-inside">
        <li>Kamera-Scoring ist gesperrt</li>
        <li>Turniere sind auf 8 Teilnehmer begrenzt</li>
      </ul>
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setPeriod("monthly")}
          className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
            period === "monthly" ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
          }`}
        >
          <p className="font-semibold text-sm">Monatlich</p>
          <p className="text-[10px] text-muted-foreground">{PRICE_DISPLAY.monthly}</p>
        </button>
        <button
          onClick={() => setPeriod("yearly")}
          className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
            period === "yearly" ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
          }`}
        >
          <p className="font-semibold text-sm">Jährlich</p>
          <p className="text-[10px] text-muted-foreground">{PRICE_DISPLAY.yearly} — günstiger</p>
        </button>
      </div>
      <Button onClick={startUpgrade} disabled={startingCheckout} className="gap-1.5 w-full">
        {startingCheckout ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
        {period === "yearly" ? "Jährlich upgraden" : "Monatlich upgraden"}
      </Button>
      <p className="text-[10px] text-muted-foreground mt-2 text-center">
        Weiterleitung zu Stripe Checkout — Kreditkarte, PayPal und Klarna wählbar.
      </p>
    </div>
  );
};

export default AdminBilling;
