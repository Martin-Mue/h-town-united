-- `attendance` (added 2026-08-21, tournament check-in state) was never added to the owner-lock
-- trigger's protected-column list — it's UI-gated to isOwner in Tournament.tsx and its own
-- earlier migration's comment calls it "organizer-only check-in state", but any authenticated
-- member could actually write it via a direct API call, since RLS itself allows any authenticated
-- UPDATE and only this trigger enforces per-column ownership. Closes that gap, matching every
-- other settings-style column.

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
  END IF;
  RETURN NEW;
END;
$$;
