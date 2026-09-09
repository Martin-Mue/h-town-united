-- Extends Runde 5's "Sets-Modus" (see 20260909172031_add_sets_mode_columns.sql, games table) to
-- tournaments: a tournament can now optionally play every match as "Best of X Sätze, je Satz
-- Best of Y Legs" instead of a flat leg race. tournaments.best_of_legs is reinterpreted as "legs
-- per set" the same way, once this is on — no parallel field needed for that half of it.
--
-- best_of_sets stays NULL for every tournament that doesn't use Sets-Modus (the overwhelming
-- majority, unchanged) — same nullable-marker convention as games.best_of_sets: NULL means "not a
-- sets tournament" and every reader (Tournament.tsx's setup form, liveGamePath's query-param
-- propagation into Game.tsx, the format-summary line on the bracket header) branches on that,
-- never on a 0/absent sets score meaning the same thing.
--
-- Guarded with if-not-exists per this project's established convention (see
-- 20260907120000_add_league_fixture_scheduled_date.sql's own comment) — the Lovable editor has
-- independently applied at least one other migration directly to the live DB before its matching
-- file was pushed here, so every migration in this repo needs to stay safe to (re)run regardless
-- of what's already live.
alter table public.tournaments
  add column if not exists best_of_sets integer;

comment on column public.tournaments.best_of_sets is
  'Sets-Modus, tournament-wide: how many sets decide EVERY match in this tournament (majority wins), e.g. 3 for "Best of 3 Sätze". NULL for every tournament that was not set up with Sets-Modus — the marker for "does this tournament use sets" (best_of_legs alone cannot distinguish that, since it is reused as "legs per set" once Sets-Modus is on). Propagated into each match''s live-play session via Tournament.tsx''s liveGamePath (?sets=1&bestOfSets=N query params), read by useTournamentLink.ts.';

-- No RLS policy changes needed: the existing tournaments policies already cover reads/writes to
-- this new column the same as every other column on this table.

-- Deliberately NOT added to the tournaments_public view (used by the anonymous /live/:slug
-- spectator pages) in this pass — PublicTournament.tsx's bracket/list/board views don't yet
-- render a sets score at all, so exposing the column there would have nothing to consume it. A
-- documented, deliberate V1 boundary (same as the online-tournament-match path, which also
-- doesn't carry Sets-Modus yet — see Tournament.tsx's startMatchOnline) rather than an oversight;
-- pick either up if actually asked for.
