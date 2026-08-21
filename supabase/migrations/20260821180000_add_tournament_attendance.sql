-- Per-participant check-in state for a tournament ("who has actually shown up"), keyed by the
-- participant's name (same key space as tournaments.players/bracket, which are name-based, not
-- player_id-based, so guest entrants without a club profile can be checked in too).
alter table public.tournaments
  add column if not exists attendance jsonb not null default '{}'::jsonb;
