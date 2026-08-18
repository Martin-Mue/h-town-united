-- Two related visibility/write gaps, both the same root cause: RLS policies on players and
-- game_legs assumed "a user only ever touches their own data" (fine for a personal tracker),
-- but this app's actual design is one shared scorekeeping session recording results on behalf
-- of whichever club members are playing — usually NOT the account that's logged in.

-- 1. players UPDATE was "auth.uid() = user_id" only. gameSync.ts's saveGameRecord tries to
--    update EVERY participating human player's stats (games_played/games_won/average/
--    high_score/double_rate/elo_rating) after a match, regardless of who's logged in — but an
--    RLS-filtered UPDATE that matches zero rows doesn't error, it just silently affects
--    nothing. So a player's stats only ever updated when THEY personally happened to be the
--    one logged in to record that particular game; every game recorded by a teammate or the
--    person running the board silently never touched the other player's row. Confirmed live:
--    a member with 5 real, correctly-linked games still showed games_played=0.
--
--    Broadened to any authenticated club member (SELECT on this table is already `true` for
--    authenticated users — full profile visibility is already the trust model here), but only
--    for the game-derived stat columns: a BEFORE UPDATE trigger blocks a non-owner from
--    changing anything else (name, bio, photos, nickname, etc.), mirroring how
--    restrict_tournament_edits_to_owner (20260816090000) scopes tournament writes by which
--    fields actually changed rather than an all-or-nothing owner check.
CREATE OR REPLACE FUNCTION public.restrict_player_profile_edits_to_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restrict_player_profile_edits ON public.players;
CREATE TRIGGER restrict_player_profile_edits
  BEFORE UPDATE ON public.players
  FOR EACH ROW
  EXECUTE FUNCTION public.restrict_player_profile_edits_to_owner();

DROP POLICY IF EXISTS "Users can update their own players" ON public.players;
CREATE POLICY "Authenticated members can update player stats"
  ON public.players FOR UPDATE
  TO authenticated
  USING (true);

-- 2. game_legs SELECT was "auth.uid() = user_id" only — never got the same club-wide-visibility
--    pass that games got in 20260604190000_security_hardening.sql, even though it's just the
--    dart-by-dart detail of those same already-club-visible games. Statistics.tsx's checkout %,
--    first-9 average, cricket MPR, per-player heatmap, and achievements are all computed from
--    game_legs with no per-recorder filter — every member except whoever happened to record the
--    most games was silently seeing incomplete/wrong advanced stats.
DROP POLICY IF EXISTS "Users can view their own game legs" ON public.game_legs;
CREATE POLICY "Authenticated members can view all club game legs"
  ON public.game_legs FOR SELECT
  TO authenticated
  USING (true);
