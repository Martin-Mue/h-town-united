-- Real Stripe billing groundwork. clubs.plan_tier already exists (2 near-duplicate migrations,
-- 20260831150000 and the Lovable auto-squash 20260901155333, both landed the same column —
-- IF NOT EXISTS here so this migration doesn't care which of those a given DB already has) and
-- already drives feature gating (see src/lib/planFeatures.ts); this adds what Stripe itself needs
-- to track a subscription against a club.
alter table public.clubs add column if not exists stripe_customer_id text;
alter table public.clubs add column if not exists stripe_subscription_id text;
-- Separate from plan_tier on purpose: plan_tier is "what the club may currently use" (what
-- clubHasFeature() reads), plan_status is Stripe's own subscription lifecycle state. A past_due
-- club can stay on plan_tier='paid' through a short grace period even while plan_status has
-- already moved to 'past_due' — collapsing both into one column would make that grace period
-- impossible to express.
alter table public.clubs add column if not exists plan_status text not null default 'none'
  check (plan_status in ('none', 'trialing', 'active', 'past_due', 'canceled'));

-- restrict_club_plan_tier_edits already blocks any auth.uid()-carrying request from changing
-- plan_tier (see 20260831150000) — a service-role Stripe webhook has no auth.uid(), so it already
-- passes through untouched, no trigger change needed. stripe_customer_id/subscription_id/
-- plan_status get the same protection for the same reason (only a webhook or direct DB access
-- should ever set them, never a logged-in user).
create or replace function public.restrict_club_billing_edits()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and (
    NEW.stripe_customer_id is distinct from OLD.stripe_customer_id
    or NEW.stripe_subscription_id is distinct from OLD.stripe_subscription_id
    or NEW.plan_status is distinct from OLD.plan_status
  ) then
    raise exception 'Abrechnungsdaten können nicht über die App geändert werden.';
  end if;
  return NEW;
end;
$function$;

drop trigger if exists clubs_restrict_billing on public.clubs;
create trigger clubs_restrict_billing before update on public.clubs
  for each row execute function public.restrict_club_billing_edits();
