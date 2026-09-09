-- Runde 5: "Sets-Modus" ("Best of X Sätze, je Satz Best of Y Legs" — das klassische Profi-Format).
-- games.best_of_legs already means exactly "legs that decide the leg race" today; with Sets-Modus
-- active the app reinterprets that same column as "legs per set" rather than adding a parallel
-- one (see GameState.setsMode's own doc comment in src/types/game.ts). What's genuinely new here
-- is the match-level SETS score, which best_of_legs/player{1,2}_legs_won have no room to express —
-- those two continue to store legs won across the WHOLE match (see gameSync.ts's totalLegsFor),
-- unaffected either way.
--
-- best_of_sets stays NULL for every game that wasn't played with Sets-Modus (the overwhelming
-- majority, unchanged) — a nullable marker column, same shape as this project's other
-- optional-feature columns, so `best_of_sets is not null` is the one place anything needs to check
-- "was this a sets match" rather than every reader having to know a 0/0 sets score also means "no
-- sets mode".
--
-- Guarded with if-not-exists per this project's established convention (see
-- 20260907120000_add_league_fixture_scheduled_date.sql's own comment) — the Lovable editor has
-- independently applied at least one other migration directly to the live DB before its matching
-- file was pushed here, so every migration in this repo needs to stay safe to (re)run regardless
-- of what's already live.
alter table public.games
  add column if not exists best_of_sets integer,
  add column if not exists player1_sets_won integer not null default 0,
  add column if not exists player2_sets_won integer not null default 0;

comment on column public.games.best_of_sets is
  'Sets-Modus: how many sets decide the match (majority wins), e.g. 3 for "Best of 3 Sätze". NULL for every game that was not played with Sets-Modus — the marker for "was this a sets match" (best_of_legs alone cannot distinguish that, since it is reused as "legs per set" once Sets-Modus is on).';
comment on column public.games.player1_sets_won is
  'Sets-Modus: player 1''s final sets score. 0 (not NULL) when Sets-Modus was not used — check best_of_sets, not this column, to tell the two cases apart.';
comment on column public.games.player2_sets_won is
  'Sets-Modus: player 2''s final sets score. 0 (not NULL) when Sets-Modus was not used — check best_of_sets, not this column, to tell the two cases apart.';

-- No RLS policy changes needed: "Users can view/insert their own games" (see the games table's
-- original migration) already covers reads/writes to these new columns the same as every other
-- column on this table.
