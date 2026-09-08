alter table public.league_fixtures
  add column scheduled_date date;

comment on column public.league_fixtures.scheduled_date is
  'Organizer-set matchday date for this fixture''s round (Spieltag) — distinct from played_at, which is only set once the fixture is actually finished. Shared across every fixture in the same round_number.';