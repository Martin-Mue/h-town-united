-- Admin-only tournament time-forecast feature (Admin.tsx "Prognose" tab): estimates how much
-- longer a running tournament will take, per remaining round and in total. Needs two things the
-- schema doesn't expose to a plain authenticated read today:
--
-- 1. Other members' tournaments. The base `tournaments` table stays owner-only for SELECT
--    (20260602182527) — 20260815170000 only opened UPDATE (bracket/champion/status) to any
--    member, never SELECT. An admin overseeing the whole club's running tournaments needs to see
--    tournaments they didn't personally create, so this needs the same admin-role SECURITY
--    DEFINER pattern as admin_list_users/admin_user_activity, not a broader RLS policy.
--
-- 2. A historical duration signal. There is no wall-clock timestamp anywhere in this schema for
--    when a leg or match started/finished (games.played_at/created_at and game_legs.created_at
--    are all written together, at match-END, by saveGameRecord — see gameSync.ts). The only real
--    historical signals are how many darts a leg actually took (game_legs.throws array length)
--    and how many legs a match actually took (games.player1_legs_won + player2_legs_won),
--    aggregated per (mode[, best_of_legs]) since a 501 leg and a Cricket leg aren't comparable and
--    match length depends on the best-of format. Aggregated server-side rather than shipped raw to
--    the client — this scans every game/leg the whole club has ever played, matching how the
--    other genuinely-club-wide reads in this schema already work (club_leaderboard,
--    club_head_to_head), unlike the per-tournament/per-player helpers in tournamentStats.ts which
--    only ever fetch one already-known, already-small scope.

CREATE OR REPLACE FUNCTION public.admin_list_active_tournaments()
RETURNS SETOF public.tournaments
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY SELECT * FROM public.tournaments WHERE status = 'active' ORDER BY created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_active_tournaments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_active_tournaments() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_tournament_forecast_mode_stats()
RETURNS TABLE(
  mode text,
  best_of_legs integer,
  avg_legs_per_match numeric,
  match_count bigint,
  avg_darts_per_leg numeric,
  leg_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    WITH match_stats AS (
      SELECT g.mode, g.best_of_legs,
             AVG(g.player1_legs_won + g.player2_legs_won) AS avg_legs_per_match,
             COUNT(*) AS match_count
      FROM public.games g
      GROUP BY g.mode, g.best_of_legs
    ),
    leg_stats AS (
      SELECT g.mode,
             AVG(jsonb_array_length(gl.throws)) AS avg_darts_per_leg,
             COUNT(*) AS leg_count
      FROM public.game_legs gl
      JOIN public.games g ON g.id = gl.game_id
      GROUP BY g.mode
    )
    SELECT m.mode, m.best_of_legs, m.avg_legs_per_match, m.match_count,
           l.avg_darts_per_leg, l.leg_count
    FROM match_stats m
    LEFT JOIN leg_stats l ON l.mode = m.mode;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_tournament_forecast_mode_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_tournament_forecast_mode_stats() TO authenticated;

-- Per player, per mode: their own average darts-per-leg — lets the forecast use a specific
-- player's known pace once a match's actual pairing is known (a round's mode resolved, its two
-- players named), falling back to the mode-wide average above for anyone with too little history.
CREATE OR REPLACE FUNCTION public.admin_tournament_forecast_player_stats()
RETURNS TABLE(
  player_name text,
  mode text,
  avg_darts_per_leg numeric,
  leg_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT gl.player_name, g.mode,
           AVG(jsonb_array_length(gl.throws)) AS avg_darts_per_leg,
           COUNT(*) AS leg_count
    FROM public.game_legs gl
    JOIN public.games g ON g.id = gl.game_id
    GROUP BY gl.player_name, g.mode;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_tournament_forecast_player_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_tournament_forecast_player_stats() TO authenticated;
