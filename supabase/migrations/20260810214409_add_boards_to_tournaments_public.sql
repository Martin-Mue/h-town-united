-- Expose the boards count on the public live view so the live page can render
-- a board-aware "upcoming matches" schedule preview.
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
  public_view
FROM public.tournaments
WHERE public_view = true;

GRANT SELECT ON public.tournaments_public TO anon, authenticated;
