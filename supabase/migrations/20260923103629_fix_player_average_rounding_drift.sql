-- apply_game_player_stats (20260823140000_server_side_player_stat_rollup.sql) folded each new
-- game's own average into the PREVIOUS game's already-1-decimal-ROUNDED `players.average` value:
--   average = ROUND((pl.average * pl.games_played + new_game_avg) / (pl.games_played + 1), 1)
-- Reconstructing from a rounded number instead of the real running total compounds a small
-- rounding error on every single game saved, so a player's lifetime average on the ranking list
-- (this column) could visibly drift away from the SAME number freshly recomputed from their real
-- game_legs history (as Statistics.tsx's own personal-profile view already does) — exactly the
-- "45.1 in der Rangliste vs. 45.3 im persönlichen Bereich" mismatch reported after a training
-- session. double_rate had a second, independent bug: its incremental formula divided by
-- `pl.games_played` (every game, Cricket included) even though double_rate is only ever updated
-- for non-Cricket games — so a player's double_rate silently diluted/stalled every time they
-- played Cricket in between, without ever actually applying that game's own rate.
--
-- Fix: recompute both as a full aggregate over the player's ENTIRE real game_legs history every
-- time (grouped by game first, then averaged across games — same "equal weight per game"
-- convention the incremental formula always intended, and the same one Statistics.tsx's
-- filteredPlayerStats uses), rather than folding one new game into a rounded running value. This
-- is always exact (no compounding rounding error, ever) and self-healing: any drift already
-- baked into a player's `average`/`double_rate` from the old formula corrects itself the next
-- time they play a game, without needing a one-off backfill. games_played becomes a real COUNT
-- from game_legs instead of a plain increment, for the same "recompute from real data, never
-- trust the previous cached number" reason. high_score is unaffected (GREATEST has no rounding
-- error to compound) but is folded into the same full-history aggregate for consistency.
CREATE OR REPLACE FUNCTION public.apply_game_player_stats(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Atomic claim: only the first call for a given game does any work. FOR UPDATE holds the row
  -- lock across the rest of this transaction, so a concurrent second call blocks here and then
  -- sees stats_applied already true once it gets in.
  PERFORM 1 FROM public.games WHERE id = p_game_id AND NOT stats_applied FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE public.games SET stats_applied = true WHERE id = p_game_id;

  -- Caller must actually be part of this specific game (the account that saved it, or a linked
  -- player named in its game_legs) — not just any authenticated user in the app.
  IF NOT EXISTS (
    SELECT 1 FROM public.games g WHERE g.id = p_game_id AND g.user_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.game_legs gl
      JOIN public.players p ON p.id = gl.player_id
      WHERE gl.game_id = p_game_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Nur Beteiligte dieses Spiels dürfen dessen Statistiken verbuchen.';
  END IF;

  -- Lets the UPDATE below through restrict_player_profile_edits_to_owner's stat-column check
  -- (see that function) — scoped to just this UPDATE via the transaction-local `true` flag, off
  -- again immediately after.
  PERFORM set_config('darts.stat_rollup', 'on', true);

  WITH touched_players AS (
    SELECT DISTINCT player_id FROM public.game_legs WHERE game_id = p_game_id AND player_id IS NOT NULL
  ),
  per_leg AS (
    SELECT
      gl.game_id, gl.player_id, g.mode,
      jsonb_array_length(COALESCE(gl.throws, '[]'::jsonb)) AS darts,
      (SELECT COALESCE(SUM((e->>'points')::numeric), 0)
         FROM jsonb_array_elements(COALESCE(gl.throws, '[]'::jsonb)) e) AS points,
      s.highest_visit, s.checkout_attempts, s.checkout_hits
    FROM public.game_legs gl
    JOIN public.games g ON g.id = gl.game_id
    CROSS JOIN LATERAL public.dart_stats_leg_summary(gl.throws, gl.starting_score) s
    WHERE gl.player_id IN (SELECT player_id FROM touched_players)
  ),
  per_game AS (
    SELECT
      game_id, player_id, MIN(mode) AS mode,
      SUM(darts) AS darts, SUM(points) AS points, MAX(highest_visit) AS game_high,
      SUM(checkout_attempts) AS co_attempts, SUM(checkout_hits) AS co_hits
    FROM per_leg
    GROUP BY game_id, player_id
  ),
  per_player AS (
    SELECT
      player_id,
      COUNT(*) AS games_played,
      AVG(CASE WHEN darts > 0 THEN (points / darts) * 3 ELSE 0 END) AS lifetime_average,
      MAX(game_high) AS lifetime_high,
      -- Only non-Cricket games ever contribute a checkout rate, matching gameSync.ts's own
      -- doubleRates (always 0 for Cricket) and Statistics.tsx's filteredPlayerStats convention.
      AVG(CASE WHEN mode <> 'cricket' AND co_attempts > 0 THEN (co_hits::numeric / co_attempts) * 100 END) AS lifetime_double_rate
    FROM per_game
    GROUP BY player_id
  )
  UPDATE public.players pl SET
    games_played = pp.games_played,
    average = ROUND(pp.lifetime_average, 1),
    high_score = GREATEST(pl.high_score, COALESCE(pp.lifetime_high, 0))::integer,
    double_rate = COALESCE(ROUND(pp.lifetime_double_rate, 1), pl.double_rate)
  FROM per_player pp
  WHERE pl.id = pp.player_id;

  PERFORM set_config('darts.stat_rollup', 'off', true);
END;
$$;
