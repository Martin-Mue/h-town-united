-- Phase 2, stage 1: add club_id to every club-scoped table, additive and zero behavior change.
-- Nullable + backfilled + indexed on the 10 populated/writable tables (training_samples
-- deliberately excluded -- camera ML training data stays pooled across clubs, not
-- competitive/private content). user_roles goes straight to NOT NULL since it's never
-- written to directly by client code (only via SECURITY DEFINER RPCs), so there's no
-- offline-queue/stale-client risk to wait out there, unlike the other 10.
--
-- No RLS policy changes in this migration -- every existing row keeps being visible under
-- today's `using (true)` policies exactly as before. That flip is a deliberately separate,
-- later migration (after the frontend that SENDS club_id on every insert is confirmed live),
-- so new rows never have a window where they'd be written without a club_id while RLS
-- already requires one.

alter table public.user_roles add column club_id uuid references public.clubs(id);
update public.user_roles set club_id = (select id from public.clubs order by created_at asc limit 1) where club_id is null;
alter table public.user_roles alter column club_id set not null;
create index idx_user_roles_club_id on public.user_roles(club_id);

alter table public.games add column club_id uuid references public.clubs(id);
update public.games set club_id = (select id from public.clubs order by created_at asc limit 1) where club_id is null;
create index idx_games_club_id on public.games(club_id);

alter table public.game_legs add column club_id uuid references public.clubs(id);
update public.game_legs set club_id = (select id from public.clubs order by created_at asc limit 1) where club_id is null;
create index idx_game_legs_club_id on public.game_legs(club_id);

alter table public.tournaments add column club_id uuid references public.clubs(id);
update public.tournaments set club_id = (select id from public.clubs order by created_at asc limit 1) where club_id is null;
create index idx_tournaments_club_id on public.tournaments(club_id);

alter table public.tournament_series add column club_id uuid references public.clubs(id);
update public.tournament_series set club_id = (select id from public.clubs order by created_at asc limit 1) where club_id is null;
create index idx_tournament_series_club_id on public.tournament_series(club_id);

alter table public.players add column club_id uuid references public.clubs(id);
update public.players set club_id = (select id from public.clubs order by created_at asc limit 1) where club_id is null;
create index idx_players_club_id on public.players(club_id);

alter table public.highlight_clips add column club_id uuid references public.clubs(id);
update public.highlight_clips set club_id = (select id from public.clubs order by created_at asc limit 1) where club_id is null;
create index idx_highlight_clips_club_id on public.highlight_clips(club_id);

alter table public.manual_180_entries add column club_id uuid references public.clubs(id);
update public.manual_180_entries set club_id = (select id from public.clubs order by created_at asc limit 1) where club_id is null;
create index idx_manual_180_entries_club_id on public.manual_180_entries(club_id);

alter table public.push_subscriptions add column club_id uuid references public.clubs(id);
update public.push_subscriptions set club_id = (select id from public.clubs order by created_at asc limit 1) where club_id is null;
create index idx_push_subscriptions_club_id on public.push_subscriptions(club_id);

alter table public.impressum add column club_id uuid references public.clubs(id);
update public.impressum set club_id = (select id from public.clubs order by created_at asc limit 1) where club_id is null;
create index idx_impressum_club_id on public.impressum(club_id);

-- The reusable "which club is the caller in" primitive. SECURITY DEFINER to match this
-- schema's own convention for every existing helper (has_role etc.), though INVOKER would
-- also work here since user_roles' own "view own roles" policy already permits this read.
-- Purely additive: not yet referenced by any policy, so this is inert until stage 2.
create or replace function public.current_club_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select club_id from public.user_roles where user_id = auth.uid() limit 1
$$;

revoke all on function public.current_club_id() from public, anon;
grant execute on function public.current_club_id() to authenticated;
