-- Saving a finished game used to be several separate client writes: the legs, the stat rollup (already a server
-- function), then games_won and Elo read and written back per player. Two devices finishing the same online game could
-- both insert the legs, and both add the win and the Elo change; a failure halfway left some players updated and others
-- not, and a retry then skipped wins and Elo for good (it found the legs and stopped).
--
-- This function does all of it under a lock on the game row, each part exactly once:
--   legs            only when the game has none yet
--   stat rollup     apply_game_player_stats, guarded by games.stats_applied as before
--   wins and Elo    guarded by the new games.results_applied
-- A second call for the same game (the other device, a retry, a replay from the offline queue) changes nothing.

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS results_applied boolean NOT NULL DEFAULT false;

-- Every game saved before this migration already had its wins and Elo written by the client.
UPDATE public.games SET results_applied = true WHERE NOT results_applied;

-- One row per leg and player; the lock below keeps concurrent saves apart, this keeps the data honest regardless.
CREATE UNIQUE INDEX IF NOT EXISTS game_legs_game_leg_player_key
  ON public.game_legs (game_id, leg_number, player_index);

CREATE OR REPLACE FUNCTION public.save_game_legs_and_results(p_game_id uuid, p_legs jsonb, p_results jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g public.games%ROWTYPE;
BEGIN
  SELECT * INTO g FROM public.games WHERE id = p_game_id FOR UPDATE;
  IF g.id IS NULL THEN
    RAISE EXCEPTION 'Spiel nicht gefunden.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.club_id = g.club_id) THEN
    RAISE EXCEPTION 'Nur Mitglieder dieses Vereins dürfen das Spiel speichern.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.game_legs WHERE game_id = p_game_id) THEN
    INSERT INTO public.game_legs (game_id, user_id, club_id, leg_number, player_index, player_name, player_id, starting_score, throws, won)
    SELECT
      p_game_id, auth.uid(), g.club_id, l.leg_number, l.player_index, l.player_name,
      -- only a profile of this club may be linked
      (SELECT p.id FROM public.players p WHERE p.id = l.player_id AND p.club_id = g.club_id),
      l.starting_score, COALESCE(l.throws, '[]'::jsonb), COALESCE(l.won, false)
    FROM jsonb_to_recordset(COALESCE(p_legs, '[]'::jsonb))
      AS l(leg_number integer, player_index integer, player_name text, player_id uuid, starting_score integer, throws jsonb, won boolean);
  END IF;

  PERFORM public.apply_game_player_stats(p_game_id);

  IF NOT g.results_applied THEN
    UPDATE public.players pl SET
      games_won = pl.games_won + CASE WHEN r.won THEN 1 ELSE 0 END,
      elo_rating = ROUND(COALESCE(pl.elo_rating, 1000)::numeric + GREATEST(-100, LEAST(100, COALESCE(r.elo_delta, 0))))
    FROM (
      SELECT DISTINCT ON (x.player_id) x.player_id, x.won, x.elo_delta
      FROM jsonb_to_recordset(COALESCE(p_results, '[]'::jsonb)) AS x(player_id uuid, won boolean, elo_delta numeric)
      WHERE x.player_id IS NOT NULL
    ) r
    WHERE pl.id = r.player_id
      AND pl.club_id = g.club_id
      -- only players who actually took part in this game
      AND EXISTS (SELECT 1 FROM public.game_legs gl WHERE gl.game_id = p_game_id AND gl.player_id = r.player_id);
    UPDATE public.games SET results_applied = true WHERE id = p_game_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_game_legs_and_results(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_game_legs_and_results(uuid, jsonb, jsonb) TO authenticated;
