-- Per-player, per-leg dart-by-dart data. The `games` table only ever stored the
-- top-2 finishers as whole-game aggregates (no leg breakdown, no first-9 average,
-- no checkout tracking, and 3-4 player games silently dropped everyone below 2nd
-- place). This table captures every player of every leg with their raw throw
-- sequence, so checkout %, highest checkout, first-9 average, and full multi-player
-- results can all be computed (client-side) instead of relying on pre-baked columns.
CREATE TABLE public.game_legs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  leg_number INTEGER NOT NULL,
  player_index INTEGER NOT NULL,
  player_name TEXT NOT NULL,
  player_id UUID REFERENCES public.players(id) ON DELETE SET NULL,
  starting_score INTEGER NOT NULL,
  -- Ordered array of {baseValue, multiplier, points} — the exact darts thrown by
  -- this player in this leg (busted visits are never included, matching in-game logic).
  throws JSONB NOT NULL DEFAULT '[]'::jsonb,
  won BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.game_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own game legs" ON public.game_legs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own game legs" ON public.game_legs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own game legs" ON public.game_legs FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_game_legs_game_id ON public.game_legs(game_id);
CREATE INDEX idx_game_legs_user_id ON public.game_legs(user_id);
CREATE INDEX idx_game_legs_player_id ON public.game_legs(player_id);
