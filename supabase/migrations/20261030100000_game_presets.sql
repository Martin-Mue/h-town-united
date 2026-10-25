-- Saved "quick game" presets: a named snapshot of the new-game setup (mode, format, players, extras),
-- private to the account that saved it so it is the same on phone and tablet.
CREATE TABLE public.game_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  config JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_game_presets_user ON public.game_presets(user_id, created_at);

ALTER TABLE public.game_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own game presets" ON public.game_presets
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users create own game presets" ON public.game_presets
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own game presets" ON public.game_presets
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own game presets" ON public.game_presets
  FOR DELETE TO authenticated USING (user_id = auth.uid());
