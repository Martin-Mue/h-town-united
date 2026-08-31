-- Phase 2 stage 6: pure data-model scaffolding for a future paid tier -- no enforcement, no
-- payment provider, no decided feature gates (explicit user choice: "data model now, gating
-- criteria decided later"). H-Town is locked to permanently-free via a trigger that only blocks
-- the in-app path, not direct DB access (the way the plan_tier value will actually be changed
-- for now, since no billing UI exists).

alter table public.clubs add column plan_tier text not null default 'trial'
  check (plan_tier in ('trial', 'free_locked', 'paid'));

comment on column public.clubs.plan_tier is
  'Scaffolding for future billing -- no enforcement exists yet. free_locked is permanent and '
  'exclusive to the original club; trial is the default for self-serve-created clubs; paid is '
  'reserved for when real billing exists. Changeable only via direct DB access, see the '
  'restrict_club_plan_tier_edits trigger.';

update public.clubs set plan_tier = 'free_locked' where name = 'H-Town United e.V.';

-- auth.uid() IS NOT NULL distinguishes "the app, any role" (has a JWT, always true for a request
-- through PostgREST) from "direct DB access" (the Supabase SQL editor, a raw service-role
-- connection -- no JWT claim to read, auth.uid() is null there). Triggers fire regardless of
-- caller privilege in Postgres (unlike RLS, a superuser/service-role connection doesn't bypass
-- them), so an unconditional block would also lock out the one path meant to still work.
create or replace function public.restrict_club_plan_tier_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.plan_tier is distinct from OLD.plan_tier and auth.uid() is not null then
    raise exception 'plan_tier kann nicht über die App geändert werden.';
  end if;
  return NEW;
end;
$$;

create trigger clubs_restrict_plan_tier
  before update on public.clubs
  for each row execute function public.restrict_club_plan_tier_edits();

-- Pre-existing gap, closed while already touching this table: clubs' anon SELECT policy is
-- currently `using (true)` on the base table, which would expose plan_tier (and any future
-- operator-only column) to any unauthenticated caller who queries the table directly instead of
-- through the app. Same fix this repo already applied to tournaments (see
-- 20260712123435_...sql's "safe view" pattern) -- a narrow public view with only the columns
-- meant to be public, base table SELECT narrowed to actual club members/admins.
create view public.clubs_public as
  select id, name, tagline, logo_path, theme_preset from public.clubs;

grant select on public.clubs_public to anon, authenticated;

drop policy "Anyone can view club branding" on public.clubs;
create policy "Club members can view their own club"
  on public.clubs for select
  to authenticated
  using (id = public.current_club_id());
