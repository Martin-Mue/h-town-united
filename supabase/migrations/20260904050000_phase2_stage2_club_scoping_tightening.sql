-- Phase 2 (multi-tenant) stage-2 tightening, deferred since 20260901 pending a drain-window check
-- (club_id IS NULL count against the offline game-save queue) -- confirmed 2026-09-04, zero NULL
-- club_id rows remain anywhere. Two real gaps closed together:
--
-- 1. club_id was still nullable on 5 tables (games, game_legs, highlight_clips, players,
--    tournaments) -- leagues/league_fixtures/online_matches were already NOT NULL from the start,
--    having been built after this convention was established.
-- 2. None of these 5 tables' INSERT policies actually checked that the inserted row's club_id
--    matches the caller's own club (current_club_id()) -- only auth.uid() = user_id. In principle
--    an authenticated member of one club could insert a row tagged with a DIFFERENT club's id via
--    a crafted direct API call (the app's own UI never does this, since ClubBrandingContext always
--    supplies the caller's real club_id -- this closes what a malicious/buggy direct call could
--    still do). players also gets its UPDATE policy tightened the same way (was "true" -- any row,
--    any club, relying entirely on the restrict_player_profile_edits_to_owner trigger for
--    per-column protection, which does NOT check club membership for the games_won/elo_rating
--    stat-rollup branch).

alter table public.games alter column club_id set not null;
drop policy "Users can insert their own games" on public.games;
create policy "Users can insert their own games" on public.games for insert to authenticated
  with check (auth.uid() = user_id and club_id = current_club_id());

alter table public.game_legs alter column club_id set not null;
drop policy "Users can insert their own game legs" on public.game_legs;
create policy "Users can insert their own game legs" on public.game_legs for insert to authenticated
  with check (auth.uid() = user_id and club_id = current_club_id());

alter table public.highlight_clips alter column club_id set not null;
drop policy "Users can insert their own highlight clips" on public.highlight_clips;
create policy "Users can insert their own highlight clips" on public.highlight_clips for insert to authenticated
  with check (auth.uid() = user_id and club_id = current_club_id());

alter table public.players alter column club_id set not null;
drop policy "Authenticated users can insert players" on public.players;
create policy "Authenticated users can insert players" on public.players for insert to authenticated
  with check (auth.uid() = user_id and club_id = current_club_id());
drop policy "Authenticated members can update player stats" on public.players;
create policy "Authenticated members can update player stats" on public.players for update to authenticated
  using (club_id = current_club_id());

alter table public.tournaments alter column club_id set not null;
drop policy "Users can insert their own tournaments" on public.tournaments;
create policy "Users can insert their own tournaments" on public.tournaments for insert to authenticated
  with check (auth.uid() = user_id and club_id = current_club_id());

-- Deliberately NOT touched here: tournaments' own UPDATE policy (still "true"/"true", relying on
-- restrict_tournament_edits_to_owner) and has_role() itself (no club_id parameter at all -- an
-- editor/admin in ANY club currently passes has_role() checks for EVERY club's data). Both are
-- real, currently-latent gaps (only one real club exists in production right now) that deserve
-- their own careful pass rather than being folded into this migration -- restrict_tournament_edits
-- _to_owner in particular already had one silent regression from a rushed CREATE OR REPLACE
-- earlier in this project's history (see the 2026-08-23 security advisor triage memory).
