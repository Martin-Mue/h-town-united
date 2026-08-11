-- highlight_clips.game_id is written mid-match (as soon as a 180/checkout/ton-plus is
-- captured), but the matching `games` row is only created when the match is saved at
-- the end — so the FK constraint made every mid-match clip insert fail. The column
-- still carries the intended game id for later cross-referencing, it's just no longer
-- DB-enforced. No cascade-delete of clips currently relies on this (there is no
-- "delete game" feature yet), so this is safe to drop.
ALTER TABLE public.highlight_clips DROP CONSTRAINT IF EXISTS highlight_clips_game_id_fkey;
