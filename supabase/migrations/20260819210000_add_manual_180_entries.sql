-- Lets a player retroactively record how many 180s they threw in a given year before the app's
-- own camera/manual tracking existed for them — one editable count per player per year, summed
-- alongside the app's own count180s()-derived tally rather than replacing it.
create table public.manual_180_entries (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  year integer not null check (year >= 1990 and year <= extract(year from now())::integer),
  count integer not null check (count >= 0),
  created_at timestamptz not null default now(),
  unique (player_id, year)
);

alter table public.manual_180_entries enable row level security;

-- Same "authenticated members see all club data" convention as games/game_legs/tournaments.
create policy "Members can view all manual 180 entries"
  on public.manual_180_entries for select
  to authenticated
  using (true);

-- Only the player themself (their own linked account) may record/edit/remove their own
-- retroactive count — mirrors how profile edits are already gated by players.user_id = auth.uid().
create policy "Players can insert their own manual 180 entries"
  on public.manual_180_entries for insert
  to authenticated
  with check (exists (select 1 from public.players p where p.id = player_id and p.user_id = auth.uid()));

create policy "Players can update their own manual 180 entries"
  on public.manual_180_entries for update
  to authenticated
  using (exists (select 1 from public.players p where p.id = player_id and p.user_id = auth.uid()));

create policy "Players can delete their own manual 180 entries"
  on public.manual_180_entries for delete
  to authenticated
  using (exists (select 1 from public.players p where p.id = player_id and p.user_id = auth.uid()));
