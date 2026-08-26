-- Expose manual_release (20260826140000) on the anonymous public live view so the pre-start gate
-- can read the organizer's explicit override. Appended after prestart_views, matching the live
-- view's actual current column order (verified via information_schema before writing this, not
-- assumed from migration file history — see reference_lovable_database_access memory for why
-- that distinction matters in this project).
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
  prestart_views,
  manual_release
FROM public.tournaments
WHERE public_view = true;

GRANT SELECT ON public.tournaments_public TO anon, authenticated;
