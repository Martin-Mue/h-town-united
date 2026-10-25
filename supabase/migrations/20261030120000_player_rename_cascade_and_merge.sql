-- Names are the glue between a profile and everything that happened under it: tournaments keep their participants
-- as plain names, games and legs keep the names as well. Two consequences this migration removes:
--   1. renaming a profile used to cut it off from its own history (old tournaments, games, highlights),
--   2. a profile created twice by mistake (a different spelling in one tournament) could not be merged back.

-- ── helpers ────────────────────────────────────────────────────────────────────────────────────
-- "Anna" -> "Anne", "Anna & Ben" -> "Anne & Ben", "Ben & Anna" -> "Ben & Anne" (doubles teams are one name "A & B").
CREATE OR REPLACE FUNCTION public.rename_in_team_name(p_text text, p_old text, p_new text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_text IS NULL THEN NULL
    WHEN p_text = p_old THEN p_new
    WHEN left(p_text, length(p_old) + 3) = p_old || ' & ' THEN p_new || substr(p_text, length(p_old) + 1)
    WHEN right(p_text, length(p_old) + 3) = ' & ' || p_old THEN left(p_text, length(p_text) - length(p_old)) || p_new
    ELSE p_text
  END
$$;

-- The same rename inside a jsonb document (tournament players / bracket / attendance), by value or key.
CREATE OR REPLACE FUNCTION public.rename_in_json(p_doc jsonb, p_old text, p_new text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT replace(
           replace(
             replace(p_doc::text, to_jsonb(p_old)::text, to_jsonb(p_new)::text),
             left(to_jsonb(p_old)::text, -1) || ' & ', left(to_jsonb(p_new)::text, -1) || ' & '),
           ' & ' || right(to_jsonb(p_old)::text, -1), ' & ' || right(to_jsonb(p_new)::text, -1)
         )::jsonb
$$;

-- ── archived tournaments: the name cascade may still rewrite them ───────────────────────────────
CREATE OR REPLACE FUNCTION public.restrict_tournament_edits_to_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Set (transaction-local) only by rename_player_everywhere / merge_players below: a renamed or merged profile must
  -- carry its name into finished tournaments too, otherwise their results fall out of the profile's statistics.
  if current_setting('darts.cascade_names', true) = 'on' then
    return NEW;
  end if;

  if OLD.status = 'finished' then
    if (to_jsonb(NEW) - 'public_view' - 'public_slug' - 'updated_at') is not distinct from (to_jsonb(OLD) - 'public_view' - 'public_slug' - 'updated_at')
       and (auth.uid() is not distinct from OLD.user_id
            or (OLD.club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin')))
    then
      return NEW;
    end if;
    raise exception 'Ein archiviertes Turnier kann nicht mehr bearbeitet werden.';
  end if;

  if auth.uid() is distinct from OLD.user_id then
    if NEW.user_id is distinct from OLD.user_id
      or NEW.club_id is distinct from OLD.club_id
      or NEW.name is distinct from OLD.name
      or NEW.mode is distinct from OLD.mode
      or NEW.game_mode is distinct from OLD.game_mode
      or NEW.best_of_legs is distinct from OLD.best_of_legs
      or NEW.players is distinct from OLD.players
      or NEW.series_id is distinct from OLD.series_id
      or NEW.round_configs is distinct from OLD.round_configs
      or NEW.max_rounds_x01 is distinct from OLD.max_rounds_x01
      or NEW.public_view is distinct from OLD.public_view
      or NEW.public_slug is distinct from OLD.public_slug
      or NEW.boards is distinct from OLD.boards
      or NEW.live_play_enabled is distinct from OLD.live_play_enabled
      or NEW.attendance is distinct from OLD.attendance
      or NEW.prestart_views is distinct from OLD.prestart_views
      or NEW.manual_release is distinct from OLD.manual_release
    then
      raise exception 'Nur der Ersteller darf die Turniereinstellungen ändern.';
    end if;
    if (NEW.bracket is distinct from OLD.bracket
        or NEW.champion is distinct from OLD.champion
        or NEW.status is distinct from OLD.status)
      and not public.has_role(auth.uid(), 'editor')
      and not exists (
        select 1 from public.players p
        where p.user_id = auth.uid()
          and p.name in (select jsonb_array_elements_text(OLD.players))
      )
    then
      raise exception 'Nur Teilnehmer, zugewiesene Schreiber oder Editoren dieses Turniers dürfen den Spielstand aktualisieren.';
    end if;
  end if;
  return NEW;
end;
$function$;

-- ── one place that rewrites a name everywhere it is stored as text ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rename_player_everywhere(p_club uuid, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_old IS NULL OR p_new IS NULL OR p_old = p_new OR btrim(p_old) = '' THEN
    RETURN;
  END IF;
  PERFORM set_config('darts.cascade_names', 'on', true);

  UPDATE public.tournaments SET
    players = public.rename_in_json(players, p_old, p_new),
    bracket = public.rename_in_json(bracket, p_old, p_new),
    attendance = public.rename_in_json(attendance, p_old, p_new),
    champion = public.rename_in_team_name(champion, p_old, p_new)
  WHERE club_id = p_club
    AND (players::text LIKE '%' || p_old || '%' OR bracket::text LIKE '%' || p_old || '%'
         OR attendance::text LIKE '%' || p_old || '%' OR champion LIKE '%' || p_old || '%');

  UPDATE public.games SET
    player1_name = public.rename_in_team_name(player1_name, p_old, p_new),
    player2_name = public.rename_in_team_name(player2_name, p_old, p_new),
    winner_name = public.rename_in_team_name(winner_name, p_old, p_new)
  WHERE club_id = p_club AND (player1_name LIKE '%' || p_old || '%' OR player2_name LIKE '%' || p_old || '%' OR winner_name LIKE '%' || p_old || '%');

  UPDATE public.game_legs SET player_name = public.rename_in_team_name(player_name, p_old, p_new)
  WHERE club_id = p_club AND player_name LIKE '%' || p_old || '%';

  UPDATE public.highlight_clips SET player_name = public.rename_in_team_name(player_name, p_old, p_new)
  WHERE club_id = p_club AND player_name LIKE '%' || p_old || '%';

  UPDATE public.league_fixtures SET
    player1_name = public.rename_in_team_name(player1_name, p_old, p_new),
    player2_name = public.rename_in_team_name(player2_name, p_old, p_new)
  WHERE club_id = p_club AND (player1_name LIKE '%' || p_old || '%' OR player2_name LIKE '%' || p_old || '%');

  UPDATE public.match_predictions SET predicted_winner = public.rename_in_team_name(predicted_winner, p_old, p_new)
  WHERE club_id = p_club AND predicted_winner LIKE '%' || p_old || '%';

  PERFORM set_config('darts.cascade_names', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.rename_player_everywhere(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rename_in_team_name(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rename_in_json(jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_in_team_name(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_in_json(jsonb, text, text) TO authenticated;

-- Renaming a profile renames it in its history, too.
CREATE OR REPLACE FUNCTION public.cascade_player_rename()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.rename_player_everywhere(NEW.club_id, OLD.name, NEW.name);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cascade_player_rename() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS players_cascade_rename ON public.players;
CREATE TRIGGER players_cascade_rename
  AFTER UPDATE OF name ON public.players
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION public.cascade_player_rename();

-- ── merge two profiles ──────────────────────────────────────────────────────────────────────────
-- Everything of p_remove moves to p_keep, then p_remove is deleted. Admin of the club only; the profile that is
-- removed must not belong to an account (the account's profile is the one that stays).
CREATE OR REPLACE FUNCTION public.merge_players(p_keep uuid, p_remove uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  k public.players%ROWTYPE;
  r public.players%ROWTYPE;
  moved_games integer;
  moved_legs integer;
BEGIN
  IF p_keep = p_remove THEN
    RAISE EXCEPTION 'Es müssen zwei verschiedene Spieler gewählt werden.';
  END IF;
  SELECT * INTO k FROM public.players WHERE id = p_keep;
  SELECT * INTO r FROM public.players WHERE id = p_remove;
  IF k.id IS NULL OR r.id IS NULL THEN
    RAISE EXCEPTION 'Spieler nicht gefunden.';
  END IF;
  IF k.club_id <> r.club_id OR k.club_id IS DISTINCT FROM public.current_club_id() OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Nur Admins dürfen Spieler ihres Vereins zusammenführen.';
  END IF;
  IF r.user_id IS NOT NULL AND r.user_id IS DISTINCT FROM k.user_id THEN
    RAISE EXCEPTION 'Der zu entfernende Spieler gehört zu einem Konto. Behalte das Profil mit Konto und entferne das andere.';
  END IF;

  PERFORM set_config('darts.stat_rollup', 'on', true);

  -- ids
  UPDATE public.games SET player1_id = p_keep WHERE player1_id = p_remove;
  UPDATE public.games SET player2_id = p_keep WHERE player2_id = p_remove;
  UPDATE public.games SET winner_id = p_keep WHERE winner_id = p_remove;
  GET DIAGNOSTICS moved_games = ROW_COUNT;
  UPDATE public.game_legs SET player_id = p_keep WHERE player_id = p_remove;
  GET DIAGNOSTICS moved_legs = ROW_COUNT;
  UPDATE public.highlight_clips SET player_id = p_keep WHERE player_id = p_remove;
  UPDATE public.manual_180_entries SET player_id = p_keep WHERE player_id = p_remove;
  UPDATE public.league_fixtures SET player1_id = p_keep WHERE player1_id = p_remove;
  UPDATE public.league_fixtures SET player2_id = p_keep WHERE player2_id = p_remove;
  UPDATE public.league_fixtures SET winner_id = p_keep WHERE winner_id = p_remove;
  UPDATE public.leagues SET participant_ids = (
    SELECT COALESCE(array_agg(DISTINCT x), '{}') FROM unnest(array_replace(participant_ids, p_remove, p_keep)) AS x
  ) WHERE p_remove = ANY (participant_ids);

  -- names (tournaments, games, legs, clips, fixtures, predictions)
  PERFORM public.rename_player_everywhere(k.club_id, r.name, k.name);

  -- statistics of the kept profile, recomputed from its (now complete) leg history — same convention as
  -- apply_game_player_stats: one equal-weight average per game.
  WITH per_leg AS (
    SELECT gl.game_id, g.mode,
      jsonb_array_length(COALESCE(gl.throws, '[]'::jsonb)) AS darts,
      (SELECT COALESCE(SUM((e->>'points')::numeric), 0) FROM jsonb_array_elements(COALESCE(gl.throws, '[]'::jsonb)) e) AS points,
      s.highest_visit, s.checkout_attempts, s.checkout_hits
    FROM public.game_legs gl
    JOIN public.games g ON g.id = gl.game_id
    CROSS JOIN LATERAL public.dart_stats_leg_summary(gl.throws, gl.starting_score) s
    WHERE gl.player_id = p_keep
  ),
  per_game AS (
    SELECT game_id, MIN(mode) AS mode, SUM(darts) AS darts, SUM(points) AS points, MAX(highest_visit) AS game_high,
      SUM(checkout_attempts) AS co_attempts, SUM(checkout_hits) AS co_hits
    FROM per_leg GROUP BY game_id
  ),
  agg AS (
    SELECT COUNT(*) AS games_played,
      AVG(CASE WHEN darts > 0 THEN (points / darts) * 3 ELSE 0 END) AS lifetime_average,
      MAX(game_high) AS lifetime_high,
      AVG(CASE WHEN mode <> 'cricket' AND co_attempts > 0 THEN (co_hits::numeric / co_attempts) * 100 END) AS lifetime_double_rate
    FROM per_game
  )
  UPDATE public.players pl SET
    games_played = agg.games_played,
    average = COALESCE(ROUND(agg.lifetime_average, 1), pl.average),
    high_score = GREATEST(pl.high_score, r.high_score, COALESCE(agg.lifetime_high, 0))::integer,
    double_rate = COALESCE(ROUND(agg.lifetime_double_rate, 1), pl.double_rate),
    games_won = pl.games_won + r.games_won
  FROM agg
  WHERE pl.id = p_keep;

  -- fill empty profile fields of the kept profile from the removed one
  UPDATE public.players pl SET
    nickname = COALESCE(pl.nickname, r.nickname),
    bio = COALESCE(pl.bio, r.bio),
    avatar_url = COALESCE(pl.avatar_url, r.avatar_url),
    hometown = COALESCE(pl.hometown, r.hometown),
    motto = COALESCE(pl.motto, r.motto)
  WHERE pl.id = p_keep;

  DELETE FROM public.players WHERE id = p_remove;
  PERFORM set_config('darts.stat_rollup', 'off', true);

  RETURN jsonb_build_object('kept', k.name, 'removed', r.name, 'games_moved', moved_games, 'legs_moved', moved_legs);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_players(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_players(uuid, uuid) TO authenticated;
