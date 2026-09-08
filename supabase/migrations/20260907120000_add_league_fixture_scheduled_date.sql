-- Round 3 Rang 10: "echte Spieltag-/Terminstruktur" — league_fixtures previously grouped fixtures
-- into an abstract "Runde N" with no real-world date at all (round_number is purely an ordering
-- index; played_at is a RESULT timestamp, only ever set once a fixture is actually finished). A
-- Spieltag (matchday) is a real calendar date the organizer schedules ahead of time, distinct from
-- both of those. One nullable column, not a new table: every fixture sharing a round_number is
-- always scheduled together (see League.tsx's UI, which writes the same date to every fixture in
-- a round in one UPDATE), so a per-round table would just be league_fixtures' own round_number
-- grouping duplicated elsewhere for no benefit.
--
-- Round 5: guarded with if-not-exists -- the Lovable editor independently generated its own copy
-- of this same migration on 08.09. (20260908155636...) and applied it directly to the live DB, so
-- this file needs to stay safe to run even though the column already exists there.
alter table public.league_fixtures
  add column if not exists scheduled_date date;

comment on column public.league_fixtures.scheduled_date is
  'Organizer-set matchday date for this fixture''s round (Spieltag) — distinct from played_at, which is only set once the fixture is actually finished. Shared across every fixture in the same round_number.';

-- No RLS policy changes needed: "Club members can update league fixtures" (see
-- 20260902200000_add_league_mode.sql) already covers writes to this new column the same as every
-- other column on this table — that policy was deliberately left open to any club member, not
-- owner-locked, since result-reporting isn't restricted to the league's creator either.
