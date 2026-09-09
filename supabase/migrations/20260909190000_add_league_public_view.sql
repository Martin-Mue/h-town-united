-- Öffentliche Liga-Ansicht (public league view) — mirrors the exact tournaments/tournaments_public
-- precedent (20260711200959 + 20260712123435): public_view/public_slug opt-in flag on the parent
-- row, an anon-facing RLS policy gated on that flag, and a security_invoker=true "_public" view
-- exposing only the safe columns.
--
-- One real architectural difference from tournaments: a tournament bracket stores player NAMES
-- as plain strings directly in its JSON, so tournaments_public never needed to touch the `players`
-- table at all. league_fixtures instead references players via player1_id/player2_id FOREIGN KEYS,
-- and the `players` table's own RLS (see 20260904050000_phase2_stage2_club_scoping_tightening.sql)
-- is scoped to authenticated club members only — not anon-readable, and deliberately left that way
-- here rather than widened, since that would leak the full roster (emoji, user_id, ...) to anyone
-- with a league link. So this migration denormalizes player1_name/player2_name directly onto
-- league_fixtures at read time (same trick tournament brackets already use), backfilling existing
-- rows once here and relying on League.tsx's createLeague() to populate them for new fixtures going
-- forward (see that file's change in this same batch).

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS public_view boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_slug text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_leagues_public_slug ON public.leagues(public_slug) WHERE public_view = true;

ALTER TABLE public.league_fixtures
  ADD COLUMN IF NOT EXISTS player1_name text,
  ADD COLUMN IF NOT EXISTS player2_name text;

-- One-time backfill for fixtures created before this migration — a plain join at migration time,
-- not a runtime dependency (createLeague() populates these directly for every fixture from here on).
UPDATE public.league_fixtures f
SET player1_name = p1.name, player2_name = p2.name
FROM public.players p1, public.players p2
WHERE p1.id = f.player1_id AND p2.id = f.player2_id
  AND (f.player1_name IS NULL OR f.player2_name IS NULL);

-- Safe public projections: only what the read-only public standings/fixtures view needs.
-- Omits club_id, created_by, created_at, updated_at on leagues; club_id, created_at, game_id,
-- player1_id/player2_id/winner_id (opaque FKs an anon visitor can't resolve anyway, but no reason
-- to hand them out) on league_fixtures.
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
  -- Exposes only WHICH side won (not the underlying player id) — enough for
  -- PublicLeague.tsx to bold the winner's name the same way League.tsx's own detail view does.
  CASE
    WHEN f.winner_id = f.player1_id THEN 1
    WHEN f.winner_id = f.player2_id THEN 2
    ELSE NULL
  END AS winner_slot,
  f.scheduled_date
FROM public.league_fixtures f
JOIN public.leagues l ON l.id = f.league_id
WHERE l.public_view = true;

-- Base table policies: allow anon SELECT ONLY for rows belonging to an opted-in league (needed for
-- the views above under security_invoker, which execute as the invoking — anon — role).
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
-- Minimal base SELECT so the views' underlying queries work for anon (RLS still restricts to
-- public_view=true rows) — same re-grant tournaments_public's own migration needed.
GRANT SELECT ON public.leagues TO anon;
GRANT SELECT ON public.league_fixtures TO anon;
