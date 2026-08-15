-- Tournament settings (name, players, mode, round_configs, etc.) stay locked to the creator
-- only — but a live-played match's result still needs to land in the bracket regardless of
-- which club member's account played it, or "Spiel starten" silently breaks for everyone
-- except the tournament's original creator. RLS can't tell "a human tapped a manual edit in
-- the admin UI" apart from "a finished live game wrote its result back" (both are plain
-- UPDATE statements on the same table), so the split is enforced by column: any authenticated
-- member may update bracket/champion/status, but every other column stays owner-only,
-- checked in a trigger (which CAN compare OLD vs NEW per-column, unlike a bare RLS policy).

DROP POLICY IF EXISTS "Users can update their own tournaments" ON public.tournaments;

CREATE POLICY "Authenticated members can update tournaments (see trigger for column limits)"
  ON public.tournaments FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

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
    THEN
      RAISE EXCEPTION 'Nur der Ersteller darf die Turniereinstellungen ändern.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournaments_restrict_edits ON public.tournaments;
CREATE TRIGGER tournaments_restrict_edits
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.restrict_tournament_edits_to_owner();
