-- Phase 2 stage 2 (part 1): flip club-wide SELECT policies from `using (true)` to
-- `using (club_id = current_club_id())`, and fix a real pre-existing bug found along the way.
--
-- Safe to apply now, independent of the frontend club_id-threading deploy (already live, commit
-- a646010) and independent of stage 4's later WITH CHECK/NOT NULL tightening: every row that
-- exists right now already has the correct backfilled club_id (stage 1), so this doesn't change
-- what any existing member can see -- it only stops a row from being visible ACROSS clubs, which
-- there's only ever been one of so far anyway.
--
-- Policy names below were re-verified live via pg_policies immediately before writing this file,
-- not copied from any earlier migration's file history -- this repo has twice shipped a
-- regression from doing the latter (see 20260823120000_restore_tournament_roster_lock.sql).

drop policy "Members can view all club games" on public.games;
create policy "Members can view all club games"
  on public.games for select
  to authenticated
  using (club_id = public.current_club_id());

drop policy "Authenticated members can view all club game legs" on public.game_legs;
create policy "Authenticated members can view all club game legs"
  on public.game_legs for select
  to authenticated
  using (club_id = public.current_club_id());

drop policy "Authenticated members can view tournaments" on public.tournaments;
create policy "Authenticated members can view tournaments"
  on public.tournaments for select
  to authenticated
  using (club_id = public.current_club_id());
-- "Anon can read public tournament rows" (public_view opt-in) is untouched -- unrelated to club
-- scoping, and an anonymous caller has no current_club_id() anyway.

drop policy "All authenticated can view series" on public.tournament_series;
create policy "All authenticated can view series"
  on public.tournament_series for select
  to authenticated
  using (club_id = public.current_club_id());

drop policy "Authenticated users can read players" on public.players;
create policy "Authenticated users can read players"
  on public.players for select
  to authenticated
  using (club_id = public.current_club_id());

drop policy "Members can view all manual 180 entries" on public.manual_180_entries;
create policy "Members can view all manual 180 entries"
  on public.manual_180_entries for select
  to authenticated
  using (club_id = public.current_club_id());

drop policy "Members can view impressum" on public.impressum;
create policy "Members can view impressum"
  on public.impressum for select
  to authenticated
  using (club_id = public.current_club_id());

-- Pre-existing bug, found while touching this exact table: 20260823130000's migration file
-- intended to flip highlight_clips (and its storage bucket) from owner-only to club-wide, but
-- verified live just now that it never actually applied -- both policies below were still their
-- original owner-only form. Folding the originally-intended fix in here rather than touching this
-- policy twice.
drop policy "Users can view their own highlight clips" on public.highlight_clips;
create policy "Authenticated members can view all club highlight clips"
  on public.highlight_clips for select
  to authenticated
  using (club_id = public.current_club_id());

drop policy "Users can view their own dart clips" on storage.objects;
create policy "Authenticated members can view all club dart clips"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'dart-clips');

-- Owner-lock triggers: club_id joins the already-locked column list on both, same treatment as
-- user_id -- a member shouldn't be able to reassign a row to a different club any more than they
-- can reassign its owner. Bodies verified live via pg_get_functiondef immediately before writing
-- this file; only the one new OR clause was added to each, nothing else changed.
create or replace function public.restrict_tournament_edits_to_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.club_id IS DISTINCT FROM OLD.club_id
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.mode IS DISTINCT FROM OLD.mode
      OR NEW.game_mode IS DISTINCT FROM OLD.game_mode
      OR NEW.best_of_legs IS DISTINCT FROM OLD.best_of_legs
      OR NEW.players IS DISTINCT FROM OLD.players
      OR NEW.series_id IS DISTINCT FROM OLD.series_id
      OR NEW.round_configs IS DISTINCT FROM OLD.round_configs
      OR NEW.max_rounds_x01 IS DISTINCT FROM OLD.max_rounds_x01
      OR NEW.public_view IS DISTINCT FROM OLD.public_view
      OR NEW.public_slug IS DISTINCT FROM OLD.public_slug
      OR NEW.boards IS DISTINCT FROM OLD.boards
      OR NEW.live_play_enabled IS DISTINCT FROM OLD.live_play_enabled
      OR NEW.attendance IS DISTINCT FROM OLD.attendance
      OR NEW.prestart_views IS DISTINCT FROM OLD.prestart_views
      OR NEW.manual_release IS DISTINCT FROM OLD.manual_release
    THEN
      RAISE EXCEPTION 'Nur der Ersteller darf die Turniereinstellungen ändern.';
    END IF;
    IF (NEW.bracket IS DISTINCT FROM OLD.bracket
        OR NEW.champion IS DISTINCT FROM OLD.champion
        OR NEW.status IS DISTINCT FROM OLD.status)
      AND NOT EXISTS (
        SELECT 1 FROM public.players p
        WHERE p.user_id = auth.uid()
          AND p.name IN (SELECT jsonb_array_elements_text(OLD.players))
      )
    THEN
      RAISE EXCEPTION 'Nur Teilnehmer oder zugewiesene Schreiber dieses Turniers dürfen den Spielstand aktualisieren.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

create or replace function public.restrict_player_profile_edits_to_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      OR NEW.club_id IS DISTINCT FROM OLD.club_id
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
