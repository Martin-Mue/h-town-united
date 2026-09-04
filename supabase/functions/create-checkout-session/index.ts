import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Starts a Stripe-hosted Checkout session for a club's paid upgrade — never touches card data
 *  directly (Checkout is Stripe's own hosted page), so this app carries no PCI scope. Which
 *  payment methods appear (card/PayPal/Klarna/...) is NOT set here — this account has "Managed
 *  Payments" enabled, which selects them automatically and actively REJECTS an explicit
 *  `payment_method_types` param (`StripeInvalidRequestError: Unsupported parameter`); configure
 *  the actual method list in the Stripe Dashboard's Payment Methods settings instead. The actual
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

    // STRIPE_SECRET_KEY is the canonical name, but on this project the key ended up stored as
    // STRIPE_TEST_API_KEY (secret values can't be read/copied through the secrets API once set,
    // so it was never renamed) — fall back to that name. Either one works.
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? Deno.env.get("STRIPE_TEST_API_KEY");
    const STRIPE_PRICE_ID_MONTHLY = Deno.env.get("STRIPE_PRICE_ID_MONTHLY");
    const STRIPE_PRICE_ID_YEARLY = Deno.env.get("STRIPE_PRICE_ID_YEARLY");
    if (!STRIPE_SECRET_KEY) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY / STRIPE_TEST_API_KEY)");
    if (!STRIPE_PRICE_ID_MONTHLY || !STRIPE_PRICE_ID_YEARLY) throw new Error("Stripe is not configured (STRIPE_PRICE_ID_MONTHLY / STRIPE_PRICE_ID_YEARLY)");
    // Managed Payments (this account's payment-method setup) requires 2025-03-31.basil or newer —
    // 2024-11-20.acacia rejects the request outright with "Managed Payments is not supported on
    // API version...". Bump this only forward in lockstep with stripe-webhook's own pinned
    // version below; a mismatch between the two isn't harmful (each call is independently
    // versioned against Stripe), but keeping them identical avoids two things to remember. The
    // `as Stripe.LatestApiVersion` cast is defensive: the pinned stripe@17.5.0 SDK's own type
    // definitions may predate this version string, which would otherwise fail Deno's type check
    // at deploy time even though the string itself is exactly what Stripe's API expects.
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-03-31.basil" as Stripe.LatestApiVersion });

    // "period" (not "interval") — matches what AdminBilling.tsx actually sends; a client sending
    // anything other than "yearly" defaults to monthly rather than erroring, same as the UI's own
    // default selection.
    const { successUrl, cancelUrl, period } = await req.json().catch(() => ({}));
    if (!successUrl || !cancelUrl) return jsonResponse({ error: "successUrl and cancelUrl are required" }, 400);
    const priceId = period === "yearly" ? STRIPE_PRICE_ID_YEARLY : STRIPE_PRICE_ID_MONTHLY;

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
