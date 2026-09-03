-- Security-advisor finding, applied live and verified via information_schema.column_privileges
-- before this file was written: clubs.stripe_customer_id/stripe_subscription_id were readable by
-- ANY authenticated club member (the base table's blanket `GRANT SELECT ON clubs TO authenticated`
-- covers every column regardless of the row-level policy, and column-level REVOKE alone doesn't
-- override a broader table-level GRANT — confirmed the hard way: an initial
-- `REVOKE SELECT (col) ... FROM authenticated` on its own did nothing while the table-level grant
-- still stood). Fixed with the correct pattern: revoke the blanket grant, re-grant an explicit
-- column allowlist that excludes the two Stripe identifiers.
revoke select, insert, update, references on public.clubs from authenticated, anon;

grant select (id, name, tagline, logo_path, theme_preset, created_at, updated_at, plan_tier, plan_status)
  on public.clubs to authenticated;
grant insert (id, name, tagline, logo_path, theme_preset, created_at, updated_at, plan_tier, plan_status)
  on public.clubs to authenticated;
-- Branding fields only — plan_tier/plan_status stay out even here since the existing
-- restrict_club_plan_tier_edits / restrict_club_billing_edits triggers already reject any write
-- to them carrying a user JWT regardless of grants; not including them in the grant is just one
-- more layer saying the same thing, not a new restriction.
grant update (name, tagline, logo_path, theme_preset) on public.clubs to authenticated;

-- stripe_customer_id/stripe_subscription_id: no grant at all for authenticated/anon. Only reached
-- via the service-role client inside create-checkout-session/stripe-webhook, which bypasses
-- column/row grants entirely — nothing in the app ever needs to read or write them client-side.
