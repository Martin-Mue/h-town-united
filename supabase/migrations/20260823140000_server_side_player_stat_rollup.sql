-- "Any logged-in user can edit any player's profile and stats" — the profile half was already
-- closed by restrict_player_profile_edits_to_owner (20260818200000). The STAT half
-- (games_played/average/high_score/double_rate) was deliberately left open for cross-player
-- writes so a match saved from either participant's device can roll up BOTH players' careers —
-- but "open for the legitimate rollup" also meant any authenticated user could set their own (or
-- anyone's) average/high_score to an arbitrary number via a raw UPDATE call, with nothing tying
-- the write back to a real game. Closes that: these four columns can now only change through
-- apply_game_player_stats(), a SECURITY DEFINER function that recomputes them itself from the
-- real dart-by-dart game_legs data (never trusts a client-supplied number) and only runs once
-- per game (idempotency via games.stats_applied).
--
-- games_won is deliberately NOT included here — crediting it correctly needs to know which team
-- a player was on and how a tied match's bull-off was resolved, and neither is reliably
-- reconstructable from persisted data alone (team membership isn't persisted at all; a
-- tiebreak-resolved tie is indistinguishable from a genuine tie by leg-win counts alone). Getting
-- that wrong would be a correctness regression on everyone's real win/loss record — worse than
-- leaving this one column's fabrication risk open for now. elo_rating is left alone for the same
-- kind of reason: its ranking algorithm (utils/elo.ts) needs every participant's pre-game rating
-- and placement, including tiebreak-aware placement, which is the same missing context.

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS stats_applied boolean NOT NULL DEFAULT false;

-- Per-leg visit/checkout summary — chunks a SINGLE leg's own throws into 3-dart visits (safe:
-- one leg is one continuous sequence for that player, see dartStats.ts's `visits()` and the
-- combineScoreTiers/combineSegmentCounts comments for why this must never span a leg boundary)
-- and replays them against that leg's own starting_score for checkout attempts/hits — mirrors
-- dartStats.ts's `highestVisit` + `computeCheckoutStats` exactly. isCheckoutPossible's reachable
-- range simplifies to "2-170 minus {163,166,169}" (checkoutTable.ts's CHECKOUT_ROUTES has an
-- entry for every integer in that range except those three) — keep both definitions in sync if
-- CHECKOUT_ROUTES ever changes.
CREATE OR REPLACE FUNCTION public.dart_stats_leg_summary(p_throws jsonb, p_starting_score integer)
RETURNS TABLE(highest_visit numeric, checkout_attempts integer, checkout_hits integer)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  visit_totals numeric[];
  remaining integer := p_starting_score;
  v_points numeric;
  v_attempts integer := 0;
  v_hits integer := 0;
  v_highest numeric := 0;
  UNREACHABLE CONSTANT integer[] := ARRAY[163, 166, 169];
BEGIN
  SELECT array_agg(visit_sum ORDER BY visit_no)
    INTO visit_totals
    FROM (
      SELECT (idx - 1) / 3 AS visit_no, SUM((elem->>'points')::numeric) AS visit_sum
      FROM jsonb_array_elements(COALESCE(p_throws, '[]'::jsonb)) WITH ORDINALITY AS t(elem, idx)
      GROUP BY (idx - 1) / 3
    ) v;

  IF visit_totals IS NULL THEN
    RETURN QUERY SELECT 0::numeric, 0, 0;
    RETURN;
  END IF;

  FOR i IN 1 .. array_length(visit_totals, 1) LOOP
    v_points := visit_totals[i];
    IF v_points > v_highest THEN v_highest := v_points; END IF;

    IF remaining BETWEEN 2 AND 170 AND NOT (remaining = ANY (UNREACHABLE)) THEN
      v_attempts := v_attempts + 1;
    END IF;
    remaining := remaining - v_points::integer;
    IF remaining = 0 THEN
      v_hits := v_hits + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_highest, v_attempts, v_hits;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_game_player_stats(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
BEGIN
  -- Atomic claim: only the first call for a given game does any work. FOR UPDATE holds the row
  -- lock across the rest of this transaction, so a concurrent second call blocks here and then
  -- sees stats_applied already true once it gets in.
  SELECT mode INTO v_mode FROM public.games WHERE id = p_game_id AND NOT stats_applied FOR UPDATE;
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

  WITH per_leg AS (
    SELECT
      gl.player_id,
      jsonb_array_length(COALESCE(gl.throws, '[]'::jsonb)) AS darts,
      (SELECT COALESCE(SUM((e->>'points')::numeric), 0)
         FROM jsonb_array_elements(COALESCE(gl.throws, '[]'::jsonb)) e) AS points,
      s.highest_visit, s.checkout_attempts, s.checkout_hits
    FROM public.game_legs gl
    CROSS JOIN LATERAL public.dart_stats_leg_summary(gl.throws, gl.starting_score) s
    WHERE gl.game_id = p_game_id AND gl.player_id IS NOT NULL
  ),
  per_player AS (
    SELECT
      player_id,
      SUM(darts) AS total_darts,
      SUM(points) AS total_points,
      MAX(highest_visit) AS game_high,
      SUM(checkout_attempts) AS co_attempts,
      SUM(checkout_hits) AS co_hits
    FROM per_leg
    GROUP BY player_id
  )
  UPDATE public.players pl SET
    games_played = pl.games_played + 1,
    average = ROUND((pl.average * pl.games_played
      + (CASE WHEN pp.total_darts > 0 THEN (pp.total_points / pp.total_darts) * 3 ELSE 0 END))
      / (pl.games_played + 1), 1),
    high_score = GREATEST(pl.high_score, COALESCE(pp.game_high, 0))::integer,
    double_rate = CASE WHEN v_mode = 'cricket' THEN pl.double_rate
      ELSE ROUND((pl.double_rate * pl.games_played
        + (CASE WHEN pp.co_attempts > 0 THEN (pp.co_hits::numeric / pp.co_attempts) * 100 ELSE 0 END))
        / (pl.games_played + 1), 1)
    END
  FROM per_player pp
  WHERE pl.id = pp.player_id;

  PERFORM set_config('darts.stat_rollup', 'off', true);
END;
$$;

-- Extends the existing owner-lock trigger: games_played/average/high_score/double_rate can now
-- only change via apply_game_player_stats() (which sets the darts.stat_rollup session flag
-- around its own UPDATE) or by the row's own owner — never by an arbitrary authenticated UPDATE.
CREATE OR REPLACE FUNCTION public.restrict_player_profile_edits_to_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  IF auth.uid() IS DISTINCT FROM OLD.user_id
     AND NOT (OLD.user_id IS NULL AND public.has_role(auth.uid(), 'admin'))
  THEN
    IF NEW.name IS DISTINCT FROM OLD.name
      OR NEW.nickname IS DISTINCT FROM OLD.nickname
      OR NEW.emoji IS DISTINCT FROM OLD.emoji
      OR NEW.bio IS DISTINCT FROM OLD.bio
      OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
      OR NEW.ai_portrait_url IS DISTINCT FROM OLD.ai_portrait_url
      OR NEW.throwing_hand IS DISTINCT FROM OLD.throwing_hand
      OR NEW.dart_weight_g IS DISTINCT FROM OLD.dart_weight_g
      OR NEW.favorite_double IS DISTINCT FROM OLD.favorite_double
      OR NEW.hometown IS DISTINCT FROM OLD.hometown
      OR NEW.joined_year IS DISTINCT FROM OLD.joined_year
      OR NEW.motto IS DISTINCT FROM OLD.motto
      OR NEW.birthday IS DISTINCT FROM OLD.birthday
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
    THEN
      RAISE EXCEPTION 'Nur das Mitglied selbst darf sein eigenes Profil bearbeiten.';
    END IF;

    IF current_setting('darts.stat_rollup', true) IS DISTINCT FROM 'on' THEN
      IF NEW.games_played IS DISTINCT FROM OLD.games_played
        OR NEW.average IS DISTINCT FROM OLD.average
        OR NEW.high_score IS DISTINCT FROM OLD.high_score
        OR NEW.double_rate IS DISTINCT FROM OLD.double_rate
      THEN
        RAISE EXCEPTION 'Spielstatistiken werden nur automatisch nach einem echten Spiel verbucht.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
