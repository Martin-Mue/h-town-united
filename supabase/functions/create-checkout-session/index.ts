import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Starts a Stripe-hosted Checkout session for a club's paid upgrade — never touches card data
 *  directly (Checkout is Stripe's own hosted page), so this app carries no PCI scope. Card,
 *  PayPal, and Klarna are all offered as selectable payment methods on that same hosted page
 *  (configured on the Price/Payment Link in the Stripe Dashboard, or via payment_method_types
 *  below) — one integration, familiar checkout options for the club admin. The actual
 *  plan_tier/plan_status flip happens later, in stripe-webhook, once Stripe confirms payment —
 *  never here, since a client hitting this endpoint hasn't paid anything yet. */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Authentication required" }, 401);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claimsData?.claims) return jsonResponse({ error: "Authentication required" }, 401);
    const callerId = claimsData.claims.sub as string;

    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    // Two prices (monthly/yearly) — the client picks which by sending "month" or "year", never a
    // raw Stripe price id: resolving through this fixed lookup, not trusting a client-supplied
    // price id directly, is what stops a tampered request from checking out at an arbitrary price.
    const PRICE_IDS: Record<"month" | "year", string | undefined> = {
      month: Deno.env.get("STRIPE_PRICE_ID_MONTHLY"),
      year: Deno.env.get("STRIPE_PRICE_ID_YEARLY"),
    };
    if (!STRIPE_SECRET_KEY) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)");
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });

    const { successUrl, cancelUrl, interval } = await req.json().catch(() => ({}));
    if (!successUrl || !cancelUrl) return jsonResponse({ error: "successUrl and cancelUrl are required" }, 400);
    if (interval !== "month" && interval !== "year") return jsonResponse({ error: "interval must be 'month' or 'year'" }, 400);
    const priceId = PRICE_IDS[interval as "month" | "year"];
    if (!priceId) throw new Error(`Stripe is not configured (STRIPE_PRICE_ID_${interval === "month" ? "MONTHLY" : "YEARLY"})`);

    // Only an admin may start an upgrade for their club — mirrors the UI gate (Admin.tsx), but
    // checked again here since this endpoint itself decides which club's Stripe customer to use.
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: callerRoles, error: rolesError } = await serviceClient
      .from("user_roles")
      .select("club_id, role")
      .eq("user_id", callerId);
    if (rolesError) throw rolesError;
    const clubId = callerRoles?.[0]?.club_id;
    const isAdmin = !!callerRoles?.some((r) => r.role === "admin");
    if (!clubId || !isAdmin) return jsonResponse({ error: "Only a club admin can start an upgrade" }, 403);

    const { data: club, error: clubError } = await serviceClient
      .from("clubs")
      .select("id, name, plan_tier, stripe_customer_id")
      .eq("id", clubId)
      .single();
    if (clubError) throw clubError;
    if (club.plan_tier === "paid" || club.plan_tier === "free_locked") {
      return jsonResponse({ error: "This club already has full access" }, 400);
    }

    let customerId = club.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({ name: club.name, metadata: { club_id: clubId } });
      customerId = customer.id;
      // service-role write — the auth.uid()-gated restrict_club_billing_edits trigger only blocks
      // writes carrying a user JWT, so this (no auth.uid() in this context) passes through.
      await serviceClient.from("clubs").update({ stripe_customer_id: customerId }).eq("id", clubId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_types: ["card", "paypal", "klarna"],
      client_reference_id: clubId,
      metadata: { club_id: clubId },
      // subscription.updated/.deleted webhook events reference the Subscription object, not the
      // Checkout Session — its own metadata (not the session's) is what stripe-webhook reads for
      // those, so club_id needs to land here too, not just on the session above.
      subscription_data: { metadata: { club_id: clubId } },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return jsonResponse({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
