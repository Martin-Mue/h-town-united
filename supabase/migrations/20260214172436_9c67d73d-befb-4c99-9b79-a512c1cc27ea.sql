
-- Players table for club member profiles
CREATE TABLE public.players (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT,
  emoji TEXT DEFAULT '🎯',
  avatar_url TEXT,
  ai_portrait_url TEXT,
  games_played INTEGER NOT NULL DEFAULT 0,
  games_won INTEGER NOT NULL DEFAULT 0,
  high_score INTEGER NOT NULL DEFAULT 0,
  average NUMERIC(6,2) NOT NULL DEFAULT 0,
  double_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

-- Public read access (club-internal, no auth yet)
CREATE POLICY "Players are publicly readable"
  ON public.players FOR SELECT
  USING (true);

CREATE POLICY "Players can be inserted by anyone"
  ON public.players FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Players can be updated by anyone"
  ON public.players FOR UPDATE
  USING (true);

CREATE POLICY "Players can be deleted by anyone"
  ON public.players FOR DELETE
  USING (true);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_players_updated_at
  BEFORE UPDATE ON public.players
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for player images
INSERT INTO storage.buckets (id, name, public) VALUES ('player-avatars', 'player-avatars', true);

-- Storage policies
CREATE POLICY "Player avatars are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'player-avatars');

CREATE POLICY "Anyone can upload player avatars"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'player-avatars');

CREATE POLICY "Anyone can update player avatars"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'player-avatars');

CREATE POLICY "Anyone can delete player avatars"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'player-avatars');
