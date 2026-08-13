-- Links a saved game back to the specific tournament bracket match it was played for
-- (tournament_id already existed but was never populated; match_id lets a game be tied
-- to one entry inside the tournament's JSON bracket, e.g. "r1-0" or "rr-3").
ALTER TABLE public.games ADD COLUMN match_id TEXT;
