-- Persistent storage for highlight clips (180s, checkouts, ton-plus visits) captured
-- by the rolling camera buffer. Previously these only existed as session-local
-- object URLs and were lost as soon as the page closed.
CREATE TABLE public.highlight_clips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  game_id UUID REFERENCES public.games(id) ON DELETE CASCADE,
  player_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  player_name TEXT NOT NULL,
  kind TEXT NOT NULL, -- '180' | 'checkout' | 'ton_plus'
  points INTEGER NOT NULL DEFAULT 0,
  darts JSONB NOT NULL DEFAULT '[]'::jsonb,
  storage_path TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'video/webm',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.highlight_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own highlight clips" ON public.highlight_clips FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own highlight clips" ON public.highlight_clips FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own highlight clips" ON public.highlight_clips FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_highlight_clips_user_id ON public.highlight_clips(user_id);
CREATE INDEX idx_highlight_clips_game_id ON public.highlight_clips(game_id);
CREATE INDEX idx_highlight_clips_created_at ON public.highlight_clips(created_at DESC);

-- Public bucket for simplicity/consistency with the existing player-avatars bucket —
-- paths are random UUIDs, not guessable/listable, and writes require auth.
INSERT INTO storage.buckets (id, name, public)
VALUES ('dart-clips', 'dart-clips', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Dart clips are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'dart-clips');

CREATE POLICY "Authenticated users can upload dart clips"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'dart-clips');

CREATE POLICY "Users can delete their own dart clips"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'dart-clips' AND owner = auth.uid());
