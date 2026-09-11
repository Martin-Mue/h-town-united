-- "PIN pro Spieler": a one-time 4-digit PIN a club member can set, entered to confirm they're
-- really the person being picked as a local (same-device) opponent in Game.tsx's setup form.
-- Only a salted hash is ever stored — see src/lib/playerPin.ts for the client-side hashing and
-- verification (fully offline, no round-trip needed at the moment someone's picked).
--
-- pin_hash/pin_salt are deliberately covered by the existing "players" SELECT policy (every club
-- member can already read every other member's roster row) rather than a narrower one: the local
-- game setup screen needs to verify a PIN against the whole roster it already has loaded, without
-- a network call. This is a casual "is it really you" confirmation among club mates, not a real
-- auth boundary — a 4-digit PIN's keyspace (10 000 values) is trivially brute-forceable by anyone
-- who'd actually bother, which the club's own README/guides should make clear to admins.
alter table public.players
  add column if not exists pin_hash text,
  add column if not exists pin_salt text;

-- Sets/changes a player's PIN. SECURITY DEFINER so this can enforce exactly "yourself, or an
-- admin acting on a walk-in (no-account) profile" without loosening the players UPDATE RLS
-- policies (self-service profile edits) to cover these two columns for everyone.
create or replace function public.set_player_pin(p_player_id uuid, p_pin_hash text, p_pin_salt text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id from public.players where id = p_player_id;
  if not found then
    raise exception 'Spieler nicht gefunden.';
  end if;
  if v_user_id is distinct from auth.uid() and not (v_user_id is null and public.has_role(auth.uid(), 'admin')) then
    raise exception 'Keine Berechtigung, die PIN dieses Spielers zu setzen.';
  end if;
  update public.players set pin_hash = p_pin_hash, pin_salt = p_pin_salt where id = p_player_id;
end;
$$;

-- Admin-only: clears (resets) ANY player's PIN, e.g. when someone forgot theirs. Separate from
-- set_player_pin above since this one is allowed regardless of who owns the profile.
create or replace function public.admin_reset_player_pin(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Nur Admins dürfen PINs zurücksetzen.';
  end if;
  update public.players set pin_hash = null, pin_salt = null where id = p_player_id;
end;
$$;

grant execute on function public.set_player_pin(uuid, text, text) to authenticated;
grant execute on function public.admin_reset_player_pin(uuid) to authenticated;
