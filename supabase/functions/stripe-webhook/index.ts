import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.5.0";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, stripe-signature" };
const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Stripe calls this directly — no Supabase session, verified instead via Stripe's own request
 *  signature (STRIPE_WEBHOOK_SECRET, set from the signing secret Stripe shows when the webhook
 *  endpoint is registered in the Dashboard). Writes plan_tier/plan_status through the
 *  service-role client: restrict_club_plan_tier_edits / restrict_club_billing_edits both only
 *  block writes that carry a user JWT (auth.uid() is not null) — a service-role call from here
 *  has none, so it already passes through both triggers unchanged, no trigger edits needed. */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    console.error("stripe-webhook: missing STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET");
    return jsonResponse({ error: "Not configured" }, 500);
  }
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });

  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();
  if (!signature) return jsonResponse({ error: "Missing stripe-signature header" }, 400);

  let event: Stripe.Event;
  try {
    // constructEventAsync (not the sync constructEvent) — Deno's runtime doesn't expose Node's
    // crypto module the sync verifier relies on; this uses Web Crypto instead, Stripe's own
    // documented approach for edge/Deno environments.
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("stripe-webhook: signature verification failed", err);
    return jsonResponse({ error: "Invalid signature" }, 400);
  }

  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const clubId = session.metadata?.club_id || session.client_reference_id;
        if (!clubId) { console.error("checkout.session.completed: no club_id"); break; }
        await serviceClient.from("clubs").update({
          plan_tier: "paid",
          plan_status: "active",
          stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id,
          stripe_subscription_id: typeof session.subscription === "string" ? session.subscription : session.subscription?.id,
        }).eq("id", clubId);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const clubId = subscription.metadata?.club_id;
        if (!clubId) { console.error(`${event.type}: no club_id in subscription metadata`); break; }
        // 'active'/'trialing' -> full access. 'past_due' keeps access through Stripe's own grace
        // period (plan_tier stays 'paid', only plan_status changes) rather than cutting a club off
        // the moment a card fails — everything else (canceled/unpaid/incomplete_expired, or this
        // being a .deleted event outright) drops back to 'trial'.
        const status = event.type === "customer.subscription.deleted" ? "canceled" : subscription.status;
        const planTier = status === "active" || status === "trialing" || status === "past_due" ? "paid" : "trial";
        const planStatus = status === "active" || status === "trialing" || status === "past_due" || status === "canceled"
          ? status : "canceled";
        await serviceClient.from("clubs").update({ plan_tier: planTier, plan_status: planStatus }).eq("id", clubId);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("stripe-webhook: handler error", err);
    return jsonResponse({ error: "Handler failed" }, 500);
  }

  return jsonResponse({ received: true });
});
