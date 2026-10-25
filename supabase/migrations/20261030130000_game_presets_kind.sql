-- The same private preset table also holds tournament templates (mode, format, boards, draw ...).
ALTER TABLE public.game_presets ADD COLUMN kind TEXT NOT NULL DEFAULT 'game' CHECK (kind IN ('game', 'tournament'));
CREATE INDEX idx_game_presets_user_kind ON public.game_presets(user_id, kind, created_at);
