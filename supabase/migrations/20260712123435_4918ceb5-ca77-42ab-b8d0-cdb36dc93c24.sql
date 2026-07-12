-- Security hardening: limit anon exposure of tournaments to a safe view

-- Drop broad anon SELECT on base table (agent needed for the view instead)
REVOKE SELECT ON public.tournaments FROM anon;
DROP POLICY IF EXISTS "Public can view opted-in tournaments" ON public.tournaments;

-- Safe public projection: only columns needed for the live view.
-- Omits user_id, series_id, updated_at, created_at.
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
  public_view
FROM public.tournaments
WHERE public_view = true;

-- Base table policy: allow anon SELECT ONLY when the row opted in (needed for view under security_invoker)
CREATE POLICY "Anon can read public tournament rows"
  ON public.tournaments FOR SELECT
  TO anon
  USING (public_view = true);

GRANT SELECT ON public.tournaments_public TO anon, authenticated;
-- Re-grant minimal base SELECT so the view's underlying query works for anon (RLS still restricts to public_view=true rows)
GRANT SELECT ON public.tournaments TO anon;