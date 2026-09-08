create table public.match_reflections (
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

create index idx_match_reflections_user_game on public.match_reflections(user_id, game_id);

grant select, insert, update, delete on public.match_reflections to authenticated;
grant all on public.match_reflections to service_role;

alter table public.match_reflections enable row level security;

create policy "Users manage only their own match reflections"
  on public.match_reflections for all to authenticated
  using (user_id = auth.uid() and club_id = public.current_club_id())
  with check (user_id = auth.uid() and club_id = public.current_club_id());