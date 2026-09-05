-- Schließt die in 20260904050000 bewusst offen gelassene Lücke: has_role() selbst kennt keinen
-- club_id-Parameter. Fix folgt dem im Code bereits etablierten Muster (club_invites,
-- club_join_requests, club-logos storage, tournaments/tournament_series DELETE) statt has_role()
-- selbst zu verändern: `club_id = current_club_id() and` vor jede betroffene has_role()-Prüfung.
--
-- Betroffene, bisher unscoped Stellen (verifiziert über die volle Migrations-Historie, nicht nur
-- den letzten Treffer pro Objekt):
--   1) user_roles: "Admins can view all roles" (select) + "Admins can manage roles" (all)
--   2) players: "Admins can delete any player" (delete)
--   3) impressum: "Admins can update impressum" (update)
--   4) restrict_player_profile_edits_to_owner() -- admin-Bypass für user_id IS NULL
--   5) tournament_series: "Users update own series" (update)
--   6) restrict_tournament_edits_to_owner() -- editor-Bypass für bracket/champion/status
--
-- Beide Funktionskörper unten sind 1:1 aus ihrer zuletzt gültigen Fassung übernommen (Funktion 4
-- aus 20260831140000, Funktion 6 aus 20260903100001) -- nur die eine neue Bedingung ergänzt, sonst
-- nichts geändert. Dieses Repo hat laut eigener Historie (20260823120000, 20260903100001) bereits
-- zweimal eine Regression genau dadurch verursacht, dass ein Funktionskörper aus der Datei-Historie
-- statt live kopiert wurde -- bitte vor dem Deploy gegen die aktuelle DB verifizieren
-- (pg_policies / pg_get_functiondef), nicht blind verlassen auf das, was hier steht.

drop policy "Admins can view all roles" on public.user_roles;
create policy "Admins can view all roles"
  on public.user_roles for select
  to authenticated
  using (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'));

drop policy "Admins can manage roles" on public.user_roles;
create policy "Admins can manage roles"
  on public.user_roles for all
  to authenticated
  using (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'))
  with check (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'));

drop policy "Admins can delete any player" on public.players;
create policy "Admins can delete any player"
  on public.players for delete
  to authenticated
  using (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'));

drop policy "Admins can update impressum" on public.impressum;
create policy "Admins can update impressum"
  on public.impressum for update
  to authenticated
  using (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'))
  with check (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'));

create or replace function public.restrict_player_profile_edits_to_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF auth.uid() IS DISTINCT FROM OLD.user_id
     AND NOT (OLD.user_id IS NULL AND OLD.club_id = public.current_club_id() AND public.has_role(auth.uid(), 'admin'))
  THEN
    IF NEW.name IS DISTINCT FROM OLD.name
      OR NEW.nickname IS DISTINCT FROM OLD.nickname
      OR NEW.emoji IS DISTINCT FROM OLD.emoji
      OR NEW.bio IS DISTINCT FROM OLD.bio
      OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
      OR NEW.ai_portrait_url IS DISTINCT FROM OLD.ai_portrait_url
      OR NEW.throwing_hand IS DISTINCT FROM OLD.throwing_hand
      OR NEW.dart_weight_g IS DISTINCT FROM OLD.dart_weight_g
      OR NEW.favorite_double IS DISTINCT FROM OLD.favorite_double
      OR NEW.hometown IS DISTINCT FROM OLD.hometown
      OR NEW.joined_year IS DISTINCT FROM OLD.joined_year
      OR NEW.motto IS DISTINCT FROM OLD.motto
      OR NEW.birthday IS DISTINCT FROM OLD.birthday
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.club_id IS DISTINCT FROM OLD.club_id
    THEN
      RAISE EXCEPTION 'Nur das Mitglied selbst darf sein eigenes Profil bearbeiten.';
    END IF;

    IF current_setting('darts.stat_rollup', true) IS DISTINCT FROM 'on' THEN
      IF NEW.games_played IS DISTINCT FROM OLD.games_played
        OR NEW.average IS DISTINCT FROM OLD.average
        OR NEW.high_score IS DISTINCT FROM OLD.high_score
        OR NEW.double_rate IS DISTINCT FROM OLD.double_rate
      THEN
        RAISE EXCEPTION 'Spielstatistiken werden nur automatisch nach einem echten Spiel verbucht.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

drop policy "Users update own series" on public.tournament_series;
create policy "Users update own series" on public.tournament_series for update to authenticated
  using (club_id = public.current_club_id() and (auth.uid() = user_id or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'editor')));

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
      and not (OLD.club_id = public.current_club_id() and public.has_role(auth.uid(), 'editor'))
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
