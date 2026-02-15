
-- Games table to store completed match results
CREATE TABLE public.games (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  mode TEXT NOT NULL DEFAULT '501',
  start_score INTEGER NOT NULL DEFAULT 501,
  best_of_legs INTEGER NOT NULL DEFAULT 1,
  player1_name TEXT NOT NULL,
  player2_name TEXT NOT NULL,
  player1_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  player2_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  player1_legs_won INTEGER NOT NULL DEFAULT 0,
  player2_legs_won INTEGER NOT NULL DEFAULT 0,
  player1_average NUMERIC NOT NULL DEFAULT 0,
  player2_average NUMERIC NOT NULL DEFAULT 0,
  player1_highscore INTEGER NOT NULL DEFAULT 0,
  player2_highscore INTEGER NOT NULL DEFAULT 0,
  player1_double_rate NUMERIC NOT NULL DEFAULT 0,
  player2_double_rate NUMERIC NOT NULL DEFAULT 0,
  player1_total_throws INTEGER NOT NULL DEFAULT 0,
  player2_total_throws INTEGER NOT NULL DEFAULT 0,
  winner_name TEXT NOT NULL,
  winner_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  tournament_id UUID,
  played_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own games" ON public.games FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own games" ON public.games FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own games" ON public.games FOR DELETE USING (auth.uid() = user_id);

-- Tournaments table
CREATE TABLE public.tournaments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'ko',
  game_mode TEXT NOT NULL DEFAULT '501',
  best_of_legs INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'setup',
  players JSONB NOT NULL DEFAULT '[]'::jsonb,
  bracket JSONB NOT NULL DEFAULT '[]'::jsonb,
  champion TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tournaments" ON public.tournaments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own tournaments" ON public.tournaments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own tournaments" ON public.tournaments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own tournaments" ON public.tournaments FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_tournaments_updated_at BEFORE UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add foreign key from games to tournaments
ALTER TABLE public.games ADD CONSTRAINT games_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE SET NULL;

-- Index for performance
CREATE INDEX idx_games_user_id ON public.games(user_id);
CREATE INDEX idx_games_played_at ON public.games(played_at DESC);
CREATE INDEX idx_tournaments_user_id ON public.tournaments(user_id);
