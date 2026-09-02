-- Tightens two permissions: deleting a season (tournament_series) is now admin-only outright —
-- a season is shared club history, not personal scratch data, so "the person who happened to
-- create it" is no longer sufficient on its own. A tournament keeps owner-delete for as long as
-- it's still active/in-setup (unchanged from before), but once archived (status = 'finished')
-- only an admin can delete it — an admin can delete a tournament in any status. A finished
-- tournament additionally becomes fully immutable once archived (no settings edits, not even by
-- its owner or an admin) — editing before archival is unaffected, still owner-only exactly as
-- the existing trigger already enforced.

drop policy "Users delete own series" on public.tournament_series;
create policy "Admins can delete series"
  on public.tournament_series for delete to authenticated
  using (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'));

drop policy "Users can delete their own tournaments" on public.tournaments;
create policy "Owner can delete active, admin can delete any"
  on public.tournaments for delete to authenticated
  using (
    club_id = public.current_club_id()
    and (
      (auth.uid() = user_id and status <> 'finished')
      or public.has_role(auth.uid(), 'admin')
    )
  );

-- Extends the existing owner-lock trigger (see
-- 20260815170000_tournament_owner_lock_with_live_result_exception.sql) with an archive check.
-- Checked against OLD.status (the row's state BEFORE this update), not NEW — so the update that
-- actually transitions a tournament INTO "finished" (recordMatchResult setting the champion) is
-- never itself blocked, only edits attempted afterward, once it's already archived.
create or replace function public.restrict_tournament_edits_to_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.status = 'finished' then
    raise exception 'Ein archiviertes Turnier kann nicht mehr bearbeitet werden.';
  end if;

  if auth.uid() is distinct from OLD.user_id then
    if NEW.user_id is distinct from OLD.user_id
      or NEW.name is distinct from OLD.name
      or NEW.mode is distinct from OLD.mode
      or NEW.game_mode is distinct from OLD.game_mode
      or NEW.best_of_legs is distinct from OLD.best_of_legs
      or NEW.players is distinct from OLD.players
      or NEW.series_id is distinct from OLD.series_id
      or NEW.round_configs is distinct from OLD.round_configs
      or NEW.max_rounds_x01 is distinct from OLD.max_rounds_x01
      or NEW.public_view is distinct from OLD.public_view
      or NEW.public_slug is distinct from OLD.public_slug
      or NEW.boards is distinct from OLD.boards
      or NEW.live_play_enabled is distinct from OLD.live_play_enabled
    then
      raise exception 'Nur der Ersteller darf die Turniereinstellungen ändern.';
    end if;
  end if;
  return NEW;
end;
$$;
