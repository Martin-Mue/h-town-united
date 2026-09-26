-- Closes the exact bug class scripts/check-has-role-scoping.mjs already flags for these two
-- functions: set_player_pin's admin-bypass and admin_reset_player_pin (both from
-- 20260911184500_add_player_pin.sql) check public.has_role(auth.uid(), 'admin') with no club
-- scoping, so an admin of ANY club could reset or overwrite the PIN of a player in a completely
-- different club. Fix follows the established pattern from 20260905090000_scope_has_role_checks_to_club.sql:
-- require `<player row>.club_id = public.current_club_id()` alongside the has_role() check.
-- Bodies are otherwise unchanged from their last live definition.

create or replace function public.set_player_pin(p_player_id uuid, p_pin_hash text, p_pin_salt text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_club_id uuid;
begin
  select user_id, club_id into v_user_id, v_club_id from public.players where id = p_player_id;
  if not found then
    raise exception 'Spieler nicht gefunden.';
  end if;
  if v_user_id is distinct from auth.uid()
     and not (v_user_id is null and v_club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'))
  then
    raise exception 'Keine Berechtigung, die PIN dieses Spielers zu setzen.';
  end if;
  update public.players set pin_hash = p_pin_hash, pin_salt = p_pin_salt where id = p_player_id;
end;
$$;

create or replace function public.admin_reset_player_pin(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.players where id = p_player_id;
  if not found then
    raise exception 'Spieler nicht gefunden.';
  end if;
  if v_club_id is distinct from public.current_club_id() or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Nur Admins dürfen PINs von Spielern des eigenen Vereins zurücksetzen.';
  end if;
  update public.players set pin_hash = null, pin_salt = null where id = p_player_id;
end;
$$;
