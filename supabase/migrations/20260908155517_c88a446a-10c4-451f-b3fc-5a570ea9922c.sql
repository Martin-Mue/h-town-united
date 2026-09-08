-- Round 5: this table was already described by 20260905120000_add_match_reflections.sql, but that
-- migration was never actually applied to the live database (confirmed via a freshly regenerated
-- src/integrations/supabase/types.ts, which has no match_reflections entry at all) -- so the
-- MatchReflection.tsx UI (already shipped) would fail every save until this runs. This file is
-- what the Lovable editor generated independently on 08.09. when re-describing the same feature.
-- Guarded with if-not-exists / if-exists throughout so it's safe to run regardless of whether this
-- file or the 05.09. one happens to run first in any given environment.
create table if not exists public.match_reflections (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null default public.current_club_id() references public.clubs(id),
  user_id uuid not null default auth.uid(),
  game_id uuid not null references public.games(id) on delete cascade,
  focus_rating smallint check (focus_rating between 1 and 5),
  went_well text,
  improve_next text,
  created_at timestamptz not null default now(),
  unique (user_id, game_id)
);

create index if not exists idx_match_reflections_user_game on public.match_reflections(user_id, game_id);

grant select, insert, update, delete on public.match_reflections to authenticated;
grant all on public.match_reflections to service_role;

alter table public.match_reflections enable row level security;

drop policy if exists "Users manage only their own match reflections" on public.match_reflections;
create policy "Users manage only their own match reflections"
  on public.match_reflections for all to authenticated
  using (user_id = auth.uid() and club_id = public.current_club_id())
  with check (user_id = auth.uid() and club_id = public.current_club_id());
