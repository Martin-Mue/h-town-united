-- Phase 2 stage 5b: "request to join" as a second path alongside admin-issued invites (see
-- 20260831120000_add_club_creation_and_invites.sql) -- the user explicitly asked for this not to
-- be the only way in. A prospective member who knows of a club (shared its /join/:clubId link
-- directly, e.g. posted on the club's own website/WhatsApp) can ask to join; the club's admin
-- approves or rejects. Unlike club_invites, this is initiated by the joiner, not the admin, and
-- isn't per-person/single-use -- the same standing link works for anyone the club shares it with,
-- same spirit as tournaments.public_slug being a standing shareable link rather than a one-time
-- token.

create table public.club_join_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  user_id uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id)
);

alter table public.club_join_requests enable row level security;

-- One live (pending) request per person per club -- a partial index rather than a plain UNIQUE
-- constraint so a rejected request doesn't permanently block that person from ever asking again
-- (a fresh row with a fresh id is created for a retry; old rejected/approved rows stay as history).
create unique index club_join_requests_one_pending_per_user
  on public.club_join_requests (club_id, user_id)
  where status = 'pending';

-- Visible to the requester themselves (to show "your request is pending/was rejected") and to
-- that club's admin (to review it) -- no one else. All writes go through the two RPCs below
-- (request_to_join_club / respond_to_join_request), same "no direct table write" convention
-- already used for user_roles and club_invites' sensitive paths -- so no INSERT/UPDATE policy
-- exists here at all.
create policy "Requester or club admin can view join requests"
  on public.club_join_requests for select
  to authenticated
  using (user_id = auth.uid() or (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin')));

grant select on public.club_join_requests to authenticated;

-- request_to_join_club(): the sole write path for creating a request. Blocks a request from
-- someone who already belongs to a club (mirrors create_club/accept_club_invite's same guard) and
-- from someone with an already-pending request for this exact club (the partial index above would
-- catch a plain duplicate insert too, but this gives a clear message instead of a raw constraint
-- violation).
create or replace function public.request_to_join_club(_club_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Bitte zuerst einloggen oder registrieren.';
  end if;
  if exists (select 1 from public.user_roles where user_id = auth.uid()) then
    raise exception 'Dieser Account gehört bereits zu einem Verein.';
  end if;
  if not exists (select 1 from public.clubs where id = _club_id) then
    raise exception 'Verein nicht gefunden.';
  end if;
  if exists (select 1 from public.club_join_requests where club_id = _club_id and user_id = auth.uid() and status = 'pending') then
    raise exception 'Du hast bereits eine offene Anfrage für diesen Verein.';
  end if;

  insert into public.club_join_requests (club_id, user_id) values (_club_id, auth.uid())
    returning id into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.request_to_join_club(uuid) from public, anon;
grant execute on function public.request_to_join_club(uuid) to authenticated;

-- respond_to_join_request(): admin-only approve/reject. Approving does the same user_roles insert
-- as accept_club_invite -- the request's OWN club_id is used (not current_club_id()) so the check
-- below can catch a cross-club admin trying to decide on a request that isn't theirs, rather than
-- silently approving into the wrong club.
create or replace function public.respond_to_join_request(_request_id uuid, _approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
begin
  select * into v_request from public.club_join_requests where id = _request_id and status = 'pending' for update;
  if not found then
    raise exception 'Anfrage nicht gefunden oder bereits entschieden.';
  end if;
  if v_request.club_id is distinct from public.current_club_id() or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Nicht berechtigt.';
  end if;

  if _approve then
    if exists (select 1 from public.user_roles where user_id = v_request.user_id) then
      raise exception 'Dieser Account gehört bereits zu einem Verein.';
    end if;
    insert into public.user_roles (user_id, club_id, role) values (v_request.user_id, v_request.club_id, 'member');
  end if;

  update public.club_join_requests
    set status = case when _approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = auth.uid()
    where id = _request_id;
end;
$$;

revoke all on function public.respond_to_join_request(uuid, boolean) from public, anon;
grant execute on function public.respond_to_join_request(uuid, boolean) to authenticated;

-- admin_list_join_requests(): the requester's email isn't on club_join_requests itself (auth.users
-- isn't PostgREST-exposed), so this does the same server-side join admin_list_users() already
-- does for the members table, scoped to the caller's own club and pending requests only.
create or replace function public.admin_list_join_requests()
returns table (
  id uuid,
  user_id uuid,
  email text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.user_id, u.email, r.created_at
  from public.club_join_requests r
  join auth.users u on u.id = r.user_id
  where r.club_id = public.current_club_id()
    and r.status = 'pending'
    and public.has_role(auth.uid(), 'admin')
  order by r.created_at asc
$$;

revoke all on function public.admin_list_join_requests() from public, anon;
grant execute on function public.admin_list_join_requests() to authenticated;
