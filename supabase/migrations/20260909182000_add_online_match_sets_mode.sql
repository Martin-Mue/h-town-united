-- Completes Sets-Modus's rollout to the online-match path — the one deliberately deferred piece
-- from 20260909180500_add_tournament_sets_mode.sql's own comment. An online match (whether a
-- casual 1v1 challenge via OnlineChallengeSetup.tsx, or a tournament-bracket match started online
-- via Tournament.tsx's startMatchOnline) can now optionally carry a sets-mode config too, the same
-- nullable-marker convention as games.best_of_sets/tournaments.best_of_sets: NULL means "not a
-- sets match" (every casual challenge, and every tournament match whose tournament doesn't use
-- Sets-Modus — the overwhelming majority, unchanged).
--
-- Consumed at accept-time by PendingOnlineChallenges.tsx's accept() — the single shared code path
-- that constructs the initial GameState for EVERY online match regardless of source_type, which is
-- why this one column change is enough to cover both casual and tournament-sourced online matches.
--
-- Guarded with if-not-exists per this project's established convention (see
-- 20260907120000_add_league_fixture_scheduled_date.sql's own comment) — the Lovable editor has
-- independently applied at least one other migration directly to the live DB before its matching
-- file was pushed here, so every migration in this repo needs to stay safe to (re)run regardless
-- of what's already live.
alter table public.online_matches
  add column if not exists best_of_sets integer;

comment on column public.online_matches.best_of_sets is
  'Sets-Modus for this online match: how many sets decide it (majority wins). NULL for every online match not played with Sets-Modus. Set by Tournament.tsx''s startMatchOnline when the source tournament itself has best_of_sets on; never set by the casual 1v1 challenge flow (OnlineChallengeSetup.tsx), which does not offer a sets-mode toggle.';

-- No RLS policy changes needed: the existing online_matches policies already cover reads/writes to
-- this new column the same as every other column on this table.
