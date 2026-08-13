-- Per-tournament switch for the "Spiel starten" bracket button: organizers who only want
-- the app for bracket display + manual result entry (e.g. matches scored on paper/another
-- system) can turn live-game launching off entirely. Defaults on to match prior behavior.
ALTER TABLE public.tournaments ADD COLUMN live_play_enabled BOOLEAN NOT NULL DEFAULT true;
