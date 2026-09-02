-- Liga-Modus: a structured round-robin competition with an auto-generated fixture list, distinct
-- from both ad-hoc Tournament brackets and TournamentSeries' points-across-tournaments scoring.
-- Two tables rather than tournaments' single JSONB-blob-with-trigger design (see
-- 20260815170000_tournament_owner_lock_with_live_result_exception.sql) specifically so writing a
-- fixture's result doesn't need that same column-level trigger complexity: league_fixtures rows
-- hold ONLY match-result-shaped data, so any club member can UPDATE them (same practical exemption
-- tournaments needed a trigger for), while leagues itself (the actual settings) stays owner-locked
-- via plain row-level RLS since it doesn't mix settings and results into the same row.

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null default public.current_club_id() references public.clubs(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  name text not null,
  -- 'single' = everyone plays everyone once; 'double' = twice (Hin- und Rückrunde).
  format text not null default 'single' check (format in ('single', 'double')),
  -- 'live' = a fixture's "Spiel starten" launches a real scored game through the app and the
  -- result writes back automatically; 'manual' = the organizer types the leg score in directly,
  -- same spirit as TournamentSeries not requiring every constituent tournament to have been
  -- played through this exact app.
  result_mode text not null default 'live' check (result_mode in ('live', 'manual')),
  game_mode text not null default '501',
  best_of_legs integer not null default 3,
  participant_ids uuid[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'finished')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_leagues_club_id on public.leagues(club_id);

alter table public.leagues enable row level security;

create policy "Club members can view leagues"
  on public.leagues for select to authenticated
  using (club_id = public.current_club_id());
create policy "Club members can create leagues"
  on public.leagues for insert to authenticated
  with check (club_id = public.current_club_id() and created_by = auth.uid());
create policy "League creator can update their league"
  on public.leagues for update to authenticated
  using (created_by = auth.uid());
create policy "League creator can delete their league"
  on public.leagues for delete to authenticated
  using (created_by = auth.uid());

create trigger update_leagues_updated_at
  before update on public.leagues
  for each row execute function public.update_updated_at_column();

create table public.league_fixtures (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null default public.current_club_id() references public.clubs(id),
  league_id uuid not null references public.leagues(id) on delete cascade,
  round_number integer not null,
  -- 'first'/'return' only meaningful for format='double' leagues (distinguishes Hin- from
  -- Rückrunde in the fixture list); always 'single' for format='single' leagues.
  leg text not null default 'single' check (leg in ('single', 'first', 'return')),
  player1_id uuid not null references public.players(id),
  player2_id uuid not null references public.players(id),
  status text not null default 'pending' check (status in ('pending', 'finished')),
  winner_id uuid references public.players(id),
  player1_legs_won integer,
  player2_legs_won integer,
  -- Set only when result_mode='live' and this fixture was completed by actually playing it
  -- through Game.tsx -- lets the fixture list link back to the real game/stats.
  game_id uuid references public.games(id) on delete set null,
  played_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_league_fixtures_league_id on public.league_fixtures(league_id);
create index idx_league_fixtures_club_id on public.league_fixtures(club_id);

alter table public.league_fixtures enable row level security;

create policy "Club members can view league fixtures"
  on public.league_fixtures for select to authenticated
  using (club_id = public.current_club_id());
-- Fixtures are bulk-generated once, by the league's own creator, at league creation -- not
-- something individual members insert freely.
create policy "League creator can insert fixtures for their league"
  on public.league_fixtures for insert to authenticated
  with check (
    club_id = public.current_club_id()
    and exists (select 1 from public.leagues l where l.id = league_id and l.created_by = auth.uid())
  );
-- Deliberately NOT owner-locked, unlike leagues itself -- whoever actually plays or reports a
-- fixture's result needs to be able to write it, not just the person who set the league up (same
-- reasoning as tournaments' bracket/champion/status exemption, just via table separation instead
-- of a column-level trigger since this table holds nothing else).
create policy "Club members can update league fixtures"
  on public.league_fixtures for update to authenticated
  using (club_id = public.current_club_id());
create policy "League creator can delete fixtures"
  on public.league_fixtures for delete to authenticated
  using (exists (select 1 from public.leagues l where l.id = league_id and l.created_by = auth.uid()));

grant select, insert, update, delete on public.leagues to authenticated;
grant select, insert, update, delete on public.league_fixtures to authenticated;
grant all on public.leagues to service_role;
grant all on public.league_fixtures to service_role;
