-- Mandantentrennung: Admin einer Vereins darf nichts außerhalb des eigenen Vereins lesen oder ändern.
--
-- Ursache: has_role(auth.uid(), 'admin') sagt nur "dieses Konto ist irgendwo Admin". Da ein Konto genau einem
-- Verein angehört, ist das praktisch "Admin des eigenen Vereins" - aber mehrere Policies und Funktionen prüften
-- NUR die Rolle und nicht, ob die betroffene Zeile zum eigenen Verein gehört. Ein Admin eines zweiten Vereins
-- hätte damit z. B. Spieler anderer Vereine löschen, deren Design/Impressum ändern, alle Rollen lesen oder die
-- KI-Trainingsbilder aller Vereine sehen können. Hier wird jede dieser Stellen auf den eigenen Verein
-- beschränkt; die Trainingsdaten gehören dem Plattform-Betreiber.

-- Spieler löschen: nur im eigenen Verein
drop policy if exists "Admins can delete any player" on public.players;
create policy "Admins can delete players of their own club"
  on public.players for delete to authenticated
  using (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'));

-- Vereinsdesign: nur der eigene Verein
drop policy if exists "Admins can update club branding" on public.clubs;
create policy "Admins can update their own club branding"
  on public.clubs for update to authenticated
  using (id = public.current_club_id() and public.has_role(auth.uid(), 'admin'))
  with check (id = public.current_club_id() and public.has_role(auth.uid(), 'admin'));

-- Impressum: nur der eigene Verein
drop policy if exists "Admins can update impressum" on public.impressum;
create policy "Admins can update their own club impressum"
  on public.impressum for update to authenticated
  using (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'))
  with check (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'));

-- Turnierserien: eigene Serien, oder Admin/Editor im eigenen Verein; neue Serien nur im eigenen Verein
drop policy if exists "Users update own series" on public.tournament_series;
create policy "Users update own series"
  on public.tournament_series for update to authenticated
  using (
    club_id = public.current_club_id()
    and (auth.uid() = user_id or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'editor'))
  )
  with check (club_id = public.current_club_id());

drop policy if exists "Users insert own series" on public.tournament_series;
create policy "Users insert own series"
  on public.tournament_series for insert to authenticated
  with check (auth.uid() = user_id and club_id = public.current_club_id());

-- Rollen: Admins sehen nur die Rollen ihres Vereins (jeder sieht weiterhin die eigenen)
drop policy if exists "Admins can view all roles" on public.user_roles;
create policy "Admins can view roles of their own club"
  on public.user_roles for select to authenticated
  using (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'));

-- KI-Trainingsdaten (Bilder und Labels) sind plattformweit: nur der Plattform-Betreiber darf sie sehen/prüfen/löschen.
drop policy if exists "Admins can view training samples" on public.training_samples;
drop policy if exists "Admins can review training samples" on public.training_samples;
drop policy if exists "Admins can delete training samples" on public.training_samples;
create policy "Platform owner can view training samples"
  on public.training_samples for select to authenticated using (public.is_platform_owner());
create policy "Platform owner can review training samples"
  on public.training_samples for update to authenticated
  using (public.is_platform_owner()) with check (public.is_platform_owner());
create policy "Platform owner can delete training samples"
  on public.training_samples for delete to authenticated using (public.is_platform_owner());

drop policy if exists "Admins can read training images" on storage.objects;
drop policy if exists "Admins can delete training images" on storage.objects;
create policy "Platform owner can read training images"
  on storage.objects for select to authenticated
  using (bucket_id = 'dart-training' and public.is_platform_owner());
create policy "Platform owner can delete training images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'dart-training' and public.is_platform_owner());

-- PIN-Funktionen: nur Spieler des eigenen Vereins
create or replace function public.admin_reset_player_pin(p_player_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Nur Admins dürfen PINs zurücksetzen.';
  end if;
  update public.players set pin_hash = null, pin_salt = null
    where id = p_player_id and club_id = public.current_club_id();
  if not found then
    raise exception 'Spieler nicht gefunden.';
  end if;
end; $$;

create or replace function public.set_player_pin(p_player_id uuid, p_pin_hash text, p_pin_salt text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_club uuid;
begin
  select user_id, club_id into v_user_id, v_club from public.players where id = p_player_id;
  if not found or v_club is distinct from public.current_club_id() then
    raise exception 'Spieler nicht gefunden.';
  end if;
  if v_user_id is distinct from auth.uid() and not (v_user_id is null and public.has_role(auth.uid(), 'admin')) then
    raise exception 'Keine Berechtigung, die PIN dieses Spielers zu setzen.';
  end if;
  update public.players set pin_hash = p_pin_hash, pin_salt = p_pin_salt where id = p_player_id;
end; $$;
