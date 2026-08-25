-- Expose `attendance` (check-in state, added 20260821180000) and the new `prestart_views`
-- (20260825120000) on the anonymous public live view, so PublicTournament.tsx's new
-- Format/Status page can show a live "checked in so far" count and the pre-start gate can read
-- which pages the organizer chose to leave open.
--
-- CORRECTED from this migration's first version: that version assumed
-- 20260810214409_add_boards_to_tournaments_public.sql's column order (with `boards` inserted
-- before `public_slug`) was already live. Querying the actual live view's
-- information_schema.columns before applying this showed `boards` was never actually there —
-- the repo's migration *file* exists, but that ALTER never landed on the real database (a
-- concrete instance of the "git history / repo file != deployed state" gap this project has hit
-- before). Postgres's CREATE OR REPLACE VIEW can only ever APPEND new trailing columns, never
-- reorder/insert existing ones — so this fixes the long-standing `boards` gap at the same time
-- (appended, not inserted), rather than failing outright or silently dropping it.
CREATE OR REPLACE VIEW public.tournaments_public
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
  round_configs,
  public_slug,
  public_view,
  boards,
  attendance,
  prestart_views
FROM public.tournaments
WHERE public_view = true;

GRANT SELECT ON public.tournaments_public TO anon, authenticated;
