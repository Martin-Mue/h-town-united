-- Post-match mini-reflection: 1-3 short, entirely optional questions offered once a game ends
-- (see MatchReflection.tsx / the winner overlay in Game.tsx) -- a few seconds of self-reflection
-- instead of another public stat.
--
-- Deliberately PRIVATE: unlike every other table added since the club_id retrofit, this one gets
-- NO "Admins can view/manage" policy at all. A club admin can see a member's match history, but
-- not how focused that member felt or what they personally want to work on -- that would defeat
-- the entire point of a private reflection. The single policy below only ever lets a row's own
-- author read or write it.
--
-- user_id/club_id both default from the calling user's own auth context rather than being sent
-- by the client, so the app-side insert (see MatchReflection.tsx) never has to compute them
-- itself and can't accidentally attribute a reflection to someone else.
--
-- Round 5: guarded with if-not-exists / if-exists -- the Lovable editor independently generated
-- its own copy of this same migration on 08.09. (20260908155517...), so this file and that one
-- now need to both be safe to run in either order in any given environment.
create table if not exists public.match_reflections (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null default public.current_club_id() references public.clubs(id),
  user_id uuid not null default auth.uid(),
  game_id uuid not null references public.games(id) on delete cascade,
  -- All three optional -- a player can rate their focus without writing a word, or write a note
  -- without rating anything. NULL, not 0/'', is "skipped".
  focus_rating smallint check (focus_rating between 1 and 5),
  went_well text,
  improve_next text,
  created_at timestamptz not null default now(),
  -- One reflection per player per game -- reopening the post-game screen updates the same row
  -- (see the upsert in MatchReflection.tsx) instead of piling up duplicates.
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
