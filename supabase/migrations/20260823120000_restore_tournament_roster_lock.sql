-- Restores the "must be a roster participant" check that 20260816090000_security_advisor_fixes.sql
-- added for tournament bracket/champion/status edits, and which 20260822090000_lock_attendance_
-- to_owner.sql silently dropped again: that migration was written against the OLDER (2026-08-15)
-- version of this trigger to add the `attendance` column, without noticing the roster check had
-- since been added — so its CREATE OR REPLACE reverted the 2026-08-16 fix while fixing an
-- unrelated gap. Net effect live right now: any authenticated user (not just this tournament's
-- players/scorekeepers) can rewrite bracket/champion/status on ANY tournament — the exact
-- "critical" finding the 2026-08-16 migration believed it had already closed.
--
-- This merges both fixes: the settings-column owner-lock (unchanged, now includes attendance)
-- plus the roster check on bracket/champion/status (restored from 2026-08-16).

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
