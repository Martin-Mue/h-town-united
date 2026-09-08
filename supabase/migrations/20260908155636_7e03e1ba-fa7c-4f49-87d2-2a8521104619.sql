-- Round 5: guarded with if-not-exists -- this migration and 20260907120000_add_league_fixture_
-- scheduled_date.sql (an earlier, independently-written file describing the same column) now
-- both need to be safe to run in either order in any given environment.
alter table public.league_fixtures
  add column if not exists scheduled_date date;

comment on column public.league_fixtures.scheduled_date is
  'Organizer-set matchday date for this fixture''s round (Spieltag) — distinct from played_at, which is only set once the fixture is actually finished. Shared across every fixture in the same round_number.';
