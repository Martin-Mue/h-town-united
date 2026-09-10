-- Saison-Liga mit Auf-/Abstieg (2026-09-10): lets an organizer set up several divisions
-- ("1. Liga", "2. Liga", ...) that share one promotion/relegation ladder, then end a season and
-- auto-generate next season's leagues with rosters reshuffled by each division's final standings.
-- Deliberately built as new columns on the EXISTING leagues table rather than a new table, since a
-- season-liga division is, in every other respect, exactly the ordinary single-division League.tsx
-- flow already supports (own fixtures, own standings, own participant_ids) -- the only new concept
-- is how a group of leagues relate to each other across divisions and across seasons.
alter table public.leagues
  -- Which season within its ladder this league row represents. 1 for a freshly created league
  -- (season or standalone) -- incremented each time "Saison beenden" spins up the next one.
  add column if not exists season_number integer not null default 1,
  -- 1 = top division. A standalone (non-season) league is simply a single division_level=1 league
  -- with no siblings at its season_group_id -- the UI treats "only one division in the group" the
  -- same as today's plain leagues, so nothing about the existing simple-league flow changes.
  add column if not exists division_level integer not null default 1,
  -- Organizer-facing label ("1. Liga", "Kreisliga A", ...) shown instead of/alongside `name` when
  -- a league is part of a multi-division group; null for a standalone league.
  add column if not exists division_name text,
  -- Groups every division of the same season-liga (across every season) together. Generated
  -- client-side once per "create season-liga" action and reused for every division inserted in
  -- that action, and copied forward unchanged onto each following season's rows -- this is what
  -- lets "Saison beenden" find every sibling division that needs to move together, and what lets
  -- the UI show "Season 2 of the Kreisliga" as one lineage rather than unrelated leagues.
  add column if not exists season_group_id uuid,
  -- How many of THIS division's bottom-of-table players move down to division_level+1 next season.
  add column if not exists relegate_count integer not null default 0,
  -- How many of THIS division's top-of-table players move up to division_level-1 next season.
  -- (Deliberately two separate counts rather than one shared "swap size" -- an organizer running a
  -- 3+ division ladder may reasonably want e.g. 2-up/2-down between div 1/2 but only 1-up/1-down
  -- between div 2/3; the season-end algorithm takes min(upper.relegate_count, lower.promote_count)
  -- at each boundary so a mismatched pair degrades safely instead of erroring.)
  add column if not exists promote_count integer not null default 0,
  -- Links a season's division to the SAME division_level's row the season before/after it, so the
  -- UI can offer "vorherige/nächste Saison" navigation without re-deriving it from
  -- season_group_id+season_number+division_level every time.
  add column if not exists previous_season_league_id uuid references public.leagues(id) on delete set null,
  add column if not exists next_season_league_id uuid references public.leagues(id) on delete set null;

-- Every league that already exists is, from the ladder's point of view, its own standalone
-- one-division group -- backfilling season_group_id to its own id makes that literal, so no
-- NULL-handling is needed anywhere downstream (every league always has a season_group_id).
update public.leagues set season_group_id = id where season_group_id is null;

create index if not exists idx_leagues_season_group on public.leagues(season_group_id);
