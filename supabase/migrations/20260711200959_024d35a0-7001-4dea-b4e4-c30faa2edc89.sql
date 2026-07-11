-- Public live view for tournaments (Stadtmeisterschaft Beamer/TV)
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS public_view boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_slug text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_tournaments_public_slug ON public.tournaments(public_slug) WHERE public_view = true;

-- Allow anonymous read only when the owner has opted in.
DROP POLICY IF EXISTS "Public can view opted-in tournaments" ON public.tournaments;
CREATE POLICY "Public can view opted-in tournaments"
  ON public.tournaments FOR SELECT
  TO anon, authenticated
  USING (public_view = true);

GRANT SELECT ON public.tournaments TO anon;