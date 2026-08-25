-- Expose `attendance` (check-in state, added 20260821180000) and the new `prestart_views`
-- (20260825120000) on the anonymous public live view, so PublicTournament.tsx's new
-- Format/Status page can show a live "checked in so far" count and the pre-start gate can read
-- which pages the organizer chose to leave open. Same shape as
-- 20260810214409_add_boards_to_tournaments_public.sql, just two more columns in the SELECT list —
-- verified against the CURRENT view definition (that migration is still the latest one to touch
-- this view's CREATE), not an older/stale copy.
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
  boards,
  public_slug,
  public_view,
  attendance,
  prestart_views
FROM public.tournaments
WHERE public_view = true;

GRANT SELECT ON public.tournaments_public TO anon, authenticated;
