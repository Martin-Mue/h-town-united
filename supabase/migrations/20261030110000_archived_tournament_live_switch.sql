-- An archived (finished) tournament stays frozen — except the live-view switch: it must still be possible to turn the
-- public page off again (or on) afterwards. Only the creator or an admin of the club may flip it; every other column
-- of a finished tournament is still locked.
CREATE OR REPLACE FUNCTION public.restrict_tournament_edits_to_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if OLD.status = 'finished' then
    if (to_jsonb(NEW) - 'public_view' - 'public_slug' - 'updated_at') is not distinct from (to_jsonb(OLD) - 'public_view' - 'public_slug' - 'updated_at')
       and (auth.uid() is not distinct from OLD.user_id
            or (OLD.club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin')))
    then
      return NEW;
    end if;
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
