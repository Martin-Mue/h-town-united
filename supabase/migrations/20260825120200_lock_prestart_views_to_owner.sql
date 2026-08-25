-- Adds `prestart_views` (20260825120000) to the owner-lock trigger's protected settings-column
-- list, matching every other organizer-only tournament setting (public_view, boards,
-- live_play_enabled, attendance, ...).
--
-- IMPORTANT precedent in this repo: 20260822090000_lock_attendance_to_owner.sql made this same
-- kind of change against a STALE base (the 2026-08-15 version of this function) and silently
-- reverted the roster-check block that 20260816090000 had added in between, which
-- 20260823120000_restore_tournament_roster_lock.sql then had to restore. To avoid repeating that,
-- this migration's body is copied byte-for-byte from the CURRENT function as defined in
-- 20260823120000 (verified by reading that file directly), with exactly one line added.

CREATE OR REPLACE FUNCTION public.restrict_tournament_edits_to_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
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
$$;
