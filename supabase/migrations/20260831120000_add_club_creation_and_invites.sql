-- Phase 2 stage 5: self-serve club creation + admin-issued invite links. Independent of the
-- club_id/RLS isolation work (stages 1-4) other than reusing current_club_id() and the club_id
-- columns those stages already added -- this is what actually makes "another club could use this
-- app" real, rather than just "another club's data would be isolated if one existed."

-- create_club(): any authenticated account with no existing membership can create a brand-new
-- club and becomes its first (and, for now, only) admin -- mirrors the retired
-- handle_new_user_role() trigger's "first user = admin" idea, just scoped per-club and made
-- explicit instead of an auth.users trigger, since club membership is no longer automatic at
-- signup. Also seeds an empty impressum row (that table's other rows are otherwise seeded only by
-- the very first migration that created it) so Settings.tsx's impressum section has a row to
-- read/update immediately, same as every existing club.
create or replace function public.create_club(_name text, _tagline text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  if exists (select 1 from public.user_roles where user_id = auth.uid()) then
    raise exception 'Dieser Account gehört bereits zu einem Verein.';
  end if;
  if trim(coalesce(_name, '')) = '' then
    raise exception 'Bitte einen Vereinsnamen angeben.';
  end if;

  insert into public.clubs (name, tagline, theme_preset)
    values (trim(_name), nullif(trim(coalesce(_tagline, '')), ''), 'default')
    returning id into v_club_id;

  insert into public.user_roles (user_id, club_id, role) values (auth.uid(), v_club_id, 'admin');

  insert into public.impressum (club_id, club_name, address, city, represented_by, email, phone, register_info)
    values (v_club_id, '', '', '', '', '', '', '');

  return v_club_id;
end;
$$;

revoke all on function public.create_club(text, text) from public, anon;
grant execute on function public.create_club(text, text) to authenticated;

-- club_invites: admin-issued, single-use, expiring, email-bound. token is a full gen_random_uuid()
-- (122 bits of real randomness) -- deliberately NOT reusing tournaments.public_slug's pattern
-- (a slugified name + 6 hex chars, ~24 bits, fine for a low-stakes public tournament code but not
-- for something that grants account-linked club access).
create table public.club_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  email text not null,
  role public.app_role not null default 'member',
  token uuid not null default gen_random_uuid() unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz
);

alter table public.club_invites enable row level security;

-- Admins manage (create/view/revoke) only their own club's invites. No public/anon SELECT policy
-- at all -- a direct SELECT would let anyone enumerate every pending invite's target email across
-- every club; the token-keyed get_invite_preview RPC below is the only anon-safe read path.
create policy "Admins manage their own club invites"
  on public.club_invites for all
  to authenticated
  using (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'))
  with check (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'));

grant select, insert, update, delete on public.club_invites to authenticated;

-- get_invite_preview(): the only anon-reachable read of an invite -- narrow, token-keyed, no
-- enumeration risk. Mirrors public_tournament_highlights()'s shape (SECURITY DEFINER, narrow
-- return columns, anon+authenticated grant).
create or replace function public.get_invite_preview(_token uuid)
returns table (
  club_name text,
  tagline text,
  logo_path text,
  expired boolean,
  already_accepted boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.name,
    c.tagline,
    c.logo_path,
    (ci.expires_at < now() and ci.accepted_at is null) as expired,
    (ci.accepted_at is not null) as already_accepted
  from public.club_invites ci
  join public.clubs c on c.id = ci.club_id
  where ci.token = _token and ci.revoked_at is null
$$;

revoke all on function public.get_invite_preview(uuid) from public, anon;
grant execute on function public.get_invite_preview(uuid) to anon, authenticated;

-- accept_club_invite(): validates + consumes the token and inserts the membership row. FOR UPDATE
-- to prevent a double-accept race across two tabs/devices, same reasoning as
-- apply_game_player_stats()'s own row claim. Hard-blocks on an email mismatch (case-insensitive)
-- rather than warning -- ties the invite to the specific person it names, and stops a
-- forwarded/leaked link being redeemed by someone else.
create or replace function public.accept_club_invite(_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Bitte zuerst einloggen oder registrieren.';
  end if;

  select * into v_invite from public.club_invites
    where token = _token and accepted_at is null and revoked_at is null and expires_at > now()
    for update;
  if not found then
    raise exception 'Diese Einladung ist ungültig oder abgelaufen.';
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if lower(trim(v_email)) is distinct from lower(trim(v_invite.email)) then
    raise exception 'Diese Einladung wurde für eine andere E-Mail-Adresse ausgestellt.';
  end if;

  if exists (select 1 from public.user_roles where user_id = auth.uid()) then
    raise exception 'Dieser Account gehört bereits zu einem Verein.';
  end if;

  insert into public.user_roles (user_id, club_id, role) values (auth.uid(), v_invite.club_id, v_invite.role);
  update public.club_invites set accepted_at = now(), accepted_by = auth.uid() where id = v_invite.id;

  return v_invite.club_id;
end;
$$;

revoke all on function public.accept_club_invite(uuid) from public, anon;
grant execute on function public.accept_club_invite(uuid) to authenticated;
