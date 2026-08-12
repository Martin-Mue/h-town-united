-- Elo-style skill rating, on top of the existing win/loss tallies. Win quota alone rewards
-- players who mostly play weaker opponents — Elo instead answers "who's actually best right
-- now" by weighting each result against the opponent's own rating. Every player starts at the
-- standard 1000 baseline; individual (non-team) finished games update it — see gameSync.ts.
ALTER TABLE public.players ADD COLUMN elo_rating INTEGER NOT NULL DEFAULT 1000;
