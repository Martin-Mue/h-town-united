alter table public.games
  add column if not exists best_of_sets integer,
  add column if not exists player1_sets_won integer not null default 0,
  add column if not exists player2_sets_won integer not null default 0;

comment on column public.games.best_of_sets is
  'Sets-Modus: how many sets decide the match (majority wins), e.g. 3 for "Best of 3 Sätze". NULL for every game that was not played with Sets-Modus — the marker for "was this a sets match" (best_of_legs alone cannot distinguish that, since it is reused as "legs per set" once Sets-Modus is on).';
comment on column public.games.player1_sets_won is
  'Sets-Modus: player 1''s final sets score. 0 (not NULL) when Sets-Modus was not used — check best_of_sets, not this column, to tell the two cases apart.';
comment on column public.games.player2_sets_won is
  'Sets-Modus: player 2''s final sets score. 0 (not NULL) when Sets-Modus was not used — check best_of_sets, not this column, to tell the two cases apart.';

alter table public.tournaments
  add column if not exists best_of_sets integer;

comment on column public.tournaments.best_of_sets is
  'Sets-Modus, tournament-wide: how many sets decide EVERY match in this tournament (majority wins), e.g. 3 for "Best of 3 Sätze". NULL for every tournament that was not set up with Sets-Modus — the marker for "does this tournament use sets" (best_of_legs alone cannot distinguish that, since it is reused as "legs per set" once Sets-Modus is on). Propagated into each match''s live-play session via Tournament.tsx''s liveGamePath (?sets=1&bestOfSets=N query params), read by useTournamentLink.ts.';

alter table public.online_matches
  add column if not exists best_of_sets integer;

comment on column public.online_matches.best_of_sets is
  'Sets-Modus for this online match: how many sets decide it (majority wins). NULL for every online match not played with Sets-Modus. Set by Tournament.tsx''s startMatchOnline when the source tournament itself has best_of_sets on; never set by the casual 1v1 challenge flow (OnlineChallengeSetup.tsx), which does not offer a sets-mode toggle.';

DROP VIEW IF EXISTS public.tournaments_public;
CREATE VIEW public.tournaments_public
WITH (security_invoker = true)
AS
SELECT
  id,
  name,
  mode,
  status,
  champion,
  players,
  bracket,
  game_mode,
  best_of_legs,
  best_of_sets,
  round_configs,
  public_slug,
  public_view,
  boards,
  attendance,
  prestart_views,
  manual_release
FROM public.tournaments
WHERE public_view = true;

GRANT SELECT ON public.tournaments_public TO anon, authenticated;

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS public_view boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_slug text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_leagues_public_slug ON public.leagues(public_slug) WHERE public_view = true;

ALTER TABLE public.league_fixtures
  ADD COLUMN IF NOT EXISTS player1_name text,
  ADD COLUMN IF NOT EXISTS player2_name text;

UPDATE public.league_fixtures f
SET player1_name = p1.name, player2_name = p2.name
FROM public.players p1, public.players p2
WHERE p1.id = f.player1_id AND p2.id = f.player2_id
  AND (f.player1_name IS NULL OR f.player2_name IS NULL);

CREATE OR REPLACE VIEW public.leagues_public
WITH (security_invoker = true)
AS
SELECT
  id,
  name,
  format,
  result_mode,
  game_mode,
  best_of_legs,
  participant_ids,
  status,
  public_slug,
  public_view
FROM public.leagues
WHERE public_view = true;

CREATE OR REPLACE VIEW public.league_fixtures_public
WITH (security_invoker = true)
AS
SELECT
  f.id,
  f.league_id,
  f.round_number,
  f.leg,
  f.player1_name,
  f.player2_name,
  f.status,
  f.player1_legs_won,
  f.player2_legs_won,
  CASE
    WHEN f.winner_id = f.player1_id THEN 1
    WHEN f.winner_id = f.player2_id THEN 2
    ELSE NULL
  END AS winner_slot,
  f.scheduled_date
FROM public.league_fixtures f
JOIN public.leagues l ON l.id = f.league_id
WHERE l.public_view = true;

CREATE POLICY "Anon can read public league rows"
  ON public.leagues FOR SELECT
  TO anon
  USING (public_view = true);

CREATE POLICY "Anon can read public league fixture rows"
  ON public.league_fixtures FOR SELECT
  TO anon
  USING (EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = league_fixtures.league_id AND l.public_view = true));

GRANT SELECT ON public.leagues_public TO anon, authenticated;
GRANT SELECT ON public.league_fixtures_public TO anon, authenticated;
GRANT SELECT ON public.leagues TO anon;
GRANT SELECT ON public.league_fixtures TO anon;