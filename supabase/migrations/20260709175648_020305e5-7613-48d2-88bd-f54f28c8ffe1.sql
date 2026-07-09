
-- Series table
CREATE TABLE public.tournament_series (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  scoring JSONB NOT NULL DEFAULT '{"champion":100,"runnerUp":70,"semi":50,"quarter":30,"participation":10}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_series TO authenticated;
GRANT ALL ON public.tournament_series TO service_role;

ALTER TABLE public.tournament_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view series"
  ON public.tournament_series FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own series"
  ON public.tournament_series FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own series"
  ON public.tournament_series FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own series"
  ON public.tournament_series FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_tournament_series_updated_at
  BEFORE UPDATE ON public.tournament_series
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Extend tournaments
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES public.tournament_series(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS round_configs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS max_rounds_x01 INTEGER;

CREATE INDEX IF NOT EXISTS idx_tournaments_series_id ON public.tournaments(series_id);
