-- URGENT REGRESSION FIX + editor-role wiring, applied together (both touch the same function).
--
-- 20260902210000_admin_only_delete_and_archive_lock.sql rewrote
-- restrict_tournament_edits_to_owner() to add the archive-lock check, but was based on a stale
-- copy of the function and silently dropped protections 20260831140000 had already put in place:
-- the club_id/attendance/prestart_views/manual_release column locks, and the ENTIRE participant-
-- only check restricting bracket/champion/status writes to actual tournament participants.
-- Between 2026-09-02 and now, ANY authenticated club member (not just participants) could freely
-- rewrite bracket/champion/status/club_id/attendance/prestart_views/manual_release on any
-- non-archived tournament. Same failure class as the incident already fixed once in
-- 20260823120000_restore_tournament_roster_lock.sql. This restores the full 20260831140000 body
-- (archive lock kept alongside it), and adds the new 'editor' role as an alternative to being a
-- roster participant for the bracket/champion/status check specifically — not for the settings
-- block above it, matching the exact scope the old TRUSTED_RESULT_EDITOR_ID hack already had.
create or replace function public.restrict_tournament_edits_to_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if OLD.status = 'finished' then
    raise exception 'Ein archiviertes Turnier kann nicht mehr bearbeitet werden.';
  end if;

  if auth.uid() is distinct from OLD.user_id then
    if NEW.user_id is distinct from OLD.user_id
      or NEW.club_id is distinct from OLD.club_id
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
      or NEW.attendance is distinct from OLD.attendance
      or NEW.prestart_views is distinct from OLD.prestart_views
      or NEW.manual_release is distinct from OLD.manual_release
    then
      raise exception 'Nur der Ersteller darf die Turniereinstellungen ändern.';
    end if;
    if (NEW.bracket is distinct from OLD.bracket
        or NEW.champion is distinct from OLD.champion
        or NEW.status is distinct from OLD.status)
      and not public.has_role(auth.uid(), 'editor')
      and not exists (
        select 1 from public.players p
        where p.user_id = auth.uid()
          and p.name in (select jsonb_array_elements_text(OLD.players))
      )
    then
      raise exception 'Nur Teilnehmer, zugewiesene Schreiber oder Editoren dieses Turniers dürfen den Spielstand aktualisieren.';
    end if;
  end if;
  return NEW;
end;
$function$;

-- tournament_series had NO admin/editor bypass on UPDATE at all before this (only DELETE) — even
-- an admin couldn't edit someone else's season. Extends it the same way the trigger above now
-- extends tournaments: owner, OR admin, OR editor.
drop policy "Users update own series" on public.tournament_series;
create policy "Users update own series" on public.tournament_series for update to authenticated
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'editor'));
