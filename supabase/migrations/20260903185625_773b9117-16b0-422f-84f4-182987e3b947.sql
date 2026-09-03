alter table public.clubs add column if not exists stripe_customer_id text;
alter table public.clubs add column if not exists stripe_subscription_id text;
alter table public.clubs add column if not exists plan_status text not null default 'none'
  check (plan_status in ('none', 'trialing', 'active', 'past_due', 'canceled'));

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