-- Autodarts for every club member (2026-11-14).
--
-- Until now Autodarts only worked through club boards an admin connected (autodarts_boards).
-- This adds:
--   * autodarts_accounts       -- every member links their OWN Autodarts login (Settings), picks their board.
--   * autodarts_player_logins  -- a fellow player confirms their own Autodarts login for one match on the
--                                 host's device (kept 12 h, never the password -- only the refresh token).
--   * autodarts_sessions       -- one Autodarts lobby/match per Dartspot leg, owned by whoever started it.
--                                 Replaces the per-board pending_* columns: several members can play at
--                                 the same time without stepping on each other's state.
--
-- All Autodarts calls still go through pg_net (CORS restricts api.autodarts.com to play.autodarts.com),
-- always as "enqueue in one RPC call, resolve in a later one" -- pg_net can't see a request before the
-- enqueuing transaction commits (see 20260917170000).
--
-- A credential is addressed as (kind, ref):
--   'account' -> autodarts_accounts.user_id
--   'board'   -> autodarts_boards.id            (club board, connected by an admin)
--   'login'   -> autodarts_player_logins.id

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table if not exists public.autodarts_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id),
  autodarts_email text,
  autodarts_user_id text,
  autodarts_username text,
  refresh_token_ciphertext text,
  access_token text,
  access_token_expires_at timestamptz,
  status text not null default 'disconnected' check (status in ('disconnected', 'connecting', 'connected', 'error')),
  last_error text,
  pending_request_id bigint,
  pending_request_kind text,          -- 'login' | 'refresh' | 'boards'
  pending_request_at timestamptz,
  boards jsonb not null default '[]'::jsonb,   -- [{id, name, type, connected}] from /bs/v0/boards
  boards_updated_at timestamptz,
  default_board_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.autodarts_player_logins (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  created_by uuid not null references auth.users(id) on delete cascade,
  autodarts_email text not null,
  autodarts_user_id text,
  autodarts_username text,
  refresh_token_ciphertext text,
  access_token text,
  access_token_expires_at timestamptz,
  status text not null default 'connecting' check (status in ('connecting', 'connected', 'error')),
  last_error text,
  pending_request_id bigint,
  pending_request_kind text,          -- 'login' | 'refresh'
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);
create index if not exists idx_autodarts_player_logins_created_by on public.autodarts_player_logins(created_by);

create table if not exists public.autodarts_sessions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  created_by uuid not null references auth.users(id) on delete cascade,
  host_kind text not null check (host_kind in ('account', 'board')),
  host_ref uuid not null,
  base_score integer not null,
  double_out boolean not null default true,
  -- ordered like the leg's throwing order: [{kind:'host'|'guest'|'login', name, login_id?}]
  players jsonb not null,
  status text not null default 'starting' check (status in ('starting', 'live', 'error', 'finished')),
  step text not null default 'tokens',
  step_data jsonb not null default '{}'::jsonb,
  pending_request_id bigint,
  pending_request_at timestamptz,
  lobby_id text,
  autodarts_board_id text,
  autodarts_board_name text,
  warnings jsonb not null default '[]'::jsonb,
  last_error text,
  pending_poll_request_id bigint,
  pending_poll_kind text,
  pending_poll_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_autodarts_sessions_created_by on public.autodarts_sessions(created_by);

-- Clients never touch these tables directly: everything goes through the SECURITY DEFINER RPCs below.
alter table public.autodarts_accounts enable row level security;
alter table public.autodarts_player_logins enable row level security;
alter table public.autodarts_sessions enable row level security;
revoke all on public.autodarts_accounts from anon, authenticated;
revoke all on public.autodarts_player_logins from anon, authenticated;
revoke all on public.autodarts_sessions from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Shared helpers (internal, not callable by clients)
-- ---------------------------------------------------------------------------------------------

create or replace function public._ad_headers(p_access_token text default null)
returns jsonb
language sql
immutable
as $function$
  select jsonb_build_object(
    'Content-Type', 'application/json',
    'Origin', 'https://play.autodarts.com',
    'Referer', 'https://play.autodarts.com/',
    'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'Accept', 'application/json, text/plain, */*',
    'Accept-Language', 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
  ) || case when p_access_token is null then '{}'::jsonb
            else jsonb_build_object('Authorization', 'Bearer ' || p_access_token) end;
$function$;

create or replace function public._ad_passphrase()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'autodarts_token_encryption_key';
  if v is null then
    raise exception 'Verschluesselungs-Schluessel nicht konfiguriert';
  end if;
  return v;
end;
$function$;

create or replace function public._ad_caller_club()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select ur.club_id from public.user_roles ur where ur.user_id = auth.uid() limit 1;
$function$;

-- A pg_net request that is neither answered nor still queued was lost (or its answer was purged,
-- pg_net keeps responses only a few hours). p_since guards the short gap right after enqueueing.
create or replace function public._ad_request_lost(p_request_id bigint, p_since timestamptz)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p_request_id is not null
     and not exists (select 1 from net._http_response r where r.id = p_request_id)
     and not exists (select 1 from net.http_request_queue q where q.id = p_request_id)
     and coalesce(p_since, '-infinity'::timestamptz) < now() - interval '30 seconds';
$function$;

-- Valid cached access token for a credential, or null.
create or replace function public._ad_cached_token(p_kind text, p_ref uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_token text;
  v_exp timestamptz;
begin
  if p_kind = 'account' then
    select access_token, access_token_expires_at into v_token, v_exp from public.autodarts_accounts where user_id = p_ref;
  elsif p_kind = 'board' then
    select access_token, access_token_expires_at into v_token, v_exp from public.autodarts_boards where id = p_ref;
  elsif p_kind = 'login' then
    select access_token, access_token_expires_at into v_token, v_exp from public.autodarts_player_logins where id = p_ref;
  end if;
  if v_token is not null and v_exp is not null and v_exp > now() + interval '60 seconds' then
    return v_token;
  end if;
  return null;
end;
$function$;

-- Enqueue a token refresh for a credential; returns the pg_net request id.
create or replace function public._ad_enqueue_refresh(p_kind text, p_ref uuid)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cipher text;
  v_refresh text;
begin
  if p_kind = 'account' then
    select refresh_token_ciphertext into v_cipher from public.autodarts_accounts where user_id = p_ref;
  elsif p_kind = 'board' then
    select refresh_token_ciphertext into v_cipher from public.autodarts_boards where id = p_ref;
  elsif p_kind = 'login' then
    select refresh_token_ciphertext into v_cipher from public.autodarts_player_logins where id = p_ref;
  end if;
  if v_cipher is null then
    raise exception 'Autodarts-Login fehlt -- bitte neu anmelden';
  end if;
  v_refresh := extensions.pgp_sym_decrypt(decode(v_cipher, 'base64'), public._ad_passphrase());
  return net.http_post(
    url := 'https://api.autodarts.com/auth/v1/refresh',
    body := jsonb_build_object('refresh_token', v_refresh, 'client_id', 'autodarts-play'),
    headers := public._ad_headers(),
    timeout_milliseconds := 15000
  );
end;
$function$;

-- Store a /auth/v1/login or /auth/v1/refresh answer for a credential. Refresh tokens rotate on use,
-- so the new one must always replace the old one.
create or replace function public._ad_store_tokens(p_kind text, p_ref uuid, p_response jsonb)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_access text := coalesce(p_response->>'access_token', p_response->>'accessToken');
  v_refresh text := coalesce(p_response->>'refresh_token', p_response->>'refreshToken');
  v_exp timestamptz := now() + make_interval(secs => coalesce(nullif(p_response->>'expires_in', '')::int, nullif(p_response->>'expiresIn', '')::int, 300));
  v_cipher text;
begin
  if v_access is null or v_refresh is null then
    raise exception 'Unerwartete Antwort von Autodarts';
  end if;
  v_cipher := encode(extensions.pgp_sym_encrypt(v_refresh, public._ad_passphrase()), 'base64');
  if p_kind = 'account' then
    update public.autodarts_accounts set refresh_token_ciphertext = v_cipher, access_token = v_access,
      access_token_expires_at = v_exp,
      autodarts_user_id = coalesce(public._jwt_claim(v_access, 'sub'), autodarts_user_id),
      autodarts_username = coalesce(public._jwt_claim(v_access, 'preferred_username'), autodarts_username),
      status = 'connected', last_error = null, updated_at = now()
    where user_id = p_ref;
  elsif p_kind = 'board' then
    perform set_config('darts.autodarts_internal_write', 'on', true);
    update public.autodarts_boards set refresh_token_ciphertext = v_cipher, access_token = v_access,
      access_token_expires_at = v_exp, token_updated_at = now(), status = 'connected', last_error = null, updated_at = now()
    where id = p_ref;
  elsif p_kind = 'login' then
    update public.autodarts_player_logins set refresh_token_ciphertext = v_cipher, access_token = v_access,
      access_token_expires_at = v_exp,
      autodarts_user_id = coalesce(public._jwt_claim(v_access, 'sub'), autodarts_user_id),
      autodarts_username = coalesce(public._jwt_claim(v_access, 'preferred_username'), autodarts_username),
      status = 'connected', last_error = null
    where id = p_ref;
  end if;
  return v_access;
end;
$function$;

-- Response body as jsonb; null for an empty or non-JSON body (an HTML error page must not make
-- the calling RPC fail on every later call).
create or replace function public._ad_json(p_content text)
returns jsonb
language plpgsql
immutable
as $function$
begin
  if p_content is null or btrim(p_content) = '' then
    return null;
  end if;
  return p_content::jsonb;
exception when others then
  return jsonb_build_object('message', left(p_content, 200));
end;
$function$;

-- Normalises /bs/v0/boards into [{id, name, type, connected}].
create or replace function public._ad_board_list(p_response jsonb)
returns jsonb
language sql
immutable
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b->>'id',
           'name', coalesce(nullif(b->>'name', ''), 'Board'),
           'type', coalesce(b->>'type', b->>'deviceType'),
           'connected', coalesce((b->'state'->>'connected')::boolean, (b->>'connected')::boolean, false)
         ) order by b->>'name'), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_response) = 'array' then p_response else '[]'::jsonb end) b
   where coalesce(b->>'type', b->>'deviceType', '') <> 'link';
$function$;

revoke all on function public._ad_headers(text) from public, anon, authenticated;
revoke all on function public._ad_passphrase() from public, anon, authenticated;
revoke all on function public._ad_caller_club() from public, anon, authenticated;
revoke all on function public._ad_request_lost(bigint, timestamptz) from public, anon, authenticated;
revoke all on function public._ad_cached_token(text, uuid) from public, anon, authenticated;
revoke all on function public._ad_enqueue_refresh(text, uuid) from public, anon, authenticated;
revoke all on function public._ad_store_tokens(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public._ad_board_list(jsonb) from public, anon, authenticated;
revoke all on function public._ad_json(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Own account (Settings)
-- ---------------------------------------------------------------------------------------------

create or replace function public.autodarts_account_link(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club uuid := public._ad_caller_club();
  v_request bigint;
begin
  if v_club is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;
  if coalesce(trim(p_email), '') = '' or coalesce(p_password, '') = '' then
    raise exception 'E-Mail und Passwort erforderlich';
  end if;
  v_request := net.http_post(
    url := 'https://api.autodarts.com/auth/v1/login',
    body := jsonb_build_object('username', trim(p_email), 'password', p_password, 'client_id', 'autodarts-play'),
    headers := public._ad_headers(),
    timeout_milliseconds := 20000
  );
  insert into public.autodarts_accounts as a (user_id, club_id, autodarts_email, status, last_error, pending_request_id, pending_request_kind, pending_request_at, updated_at)
  values (auth.uid(), v_club, trim(p_email), 'connecting', null, v_request, 'login', now(), now())
  on conflict (user_id) do update set club_id = excluded.club_id, autodarts_email = excluded.autodarts_email,
    status = 'connecting', last_error = null, pending_request_id = v_request, pending_request_kind = 'login',
    pending_request_at = now(), updated_at = now();
  return jsonb_build_object('status', 'connecting');
end;
$function$;

-- Re-reads the board list (to see which board is online right now).
create or replace function public.autodarts_account_reload_boards()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.autodarts_accounts;
  v_token text;
  v_request bigint;
begin
  select * into v_row from public.autodarts_accounts where user_id = auth.uid();
  if v_row.user_id is null or v_row.refresh_token_ciphertext is null then
    raise exception 'Kein Autodarts-Konto verknuepft';
  end if;
  if v_row.pending_request_id is not null and not public._ad_request_lost(v_row.pending_request_id, v_row.pending_request_at) then
    return jsonb_build_object('status', 'loading');
  end if;
  v_token := public._ad_cached_token('account', auth.uid());
  if v_token is not null then
    v_request := net.http_get(url := 'https://api.autodarts.com/bs/v0/boards', headers := public._ad_headers(v_token), timeout_milliseconds := 10000);
    update public.autodarts_accounts set pending_request_id = v_request, pending_request_kind = 'boards', pending_request_at = now() where user_id = auth.uid();
  else
    v_request := public._ad_enqueue_refresh('account', auth.uid());
    update public.autodarts_accounts set pending_request_id = v_request, pending_request_kind = 'refresh', pending_request_at = now() where user_id = auth.uid();
  end if;
  return jsonb_build_object('status', 'loading');
end;
$function$;

-- Polled by the Settings card: resolves a pending login/refresh/boards request and returns the
-- account as the client may see it (never a token).
create or replace function public.autodarts_account_status()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.autodarts_accounts;
  v_status int;
  v_response jsonb;
  v_token text;
  v_request bigint;
  v_loading boolean := false;
begin
  select * into v_row from public.autodarts_accounts where user_id = auth.uid();
  if v_row.user_id is null then
    return jsonb_build_object('status', 'disconnected');
  end if;

  if v_row.pending_request_id is not null then
    select r.status_code, public._ad_json(r.content)
      into v_status, v_response from net._http_response r where r.id = v_row.pending_request_id;

    if v_status is null then
      if public._ad_request_lost(v_row.pending_request_id, v_row.pending_request_at) then
        update public.autodarts_accounts set pending_request_id = null, pending_request_kind = null,
          status = case when v_row.pending_request_kind = 'login' then 'error' else status end,
          last_error = case when v_row.pending_request_kind = 'login' then 'Autodarts hat nicht geantwortet -- bitte erneut versuchen' else last_error end
        where user_id = auth.uid();
      else
        v_loading := true;
      end if;
    elsif v_row.pending_request_kind in ('login', 'refresh') then
      if v_status <> 200 then
        update public.autodarts_accounts set pending_request_id = null, pending_request_kind = null,
          status = 'error',
          last_error = case when v_row.pending_request_kind = 'login'
                            then 'Anmeldung fehlgeschlagen -- E-Mail oder Passwort pruefen'
                            else 'Autodarts-Anmeldung abgelaufen -- bitte neu verbinden' end,
          updated_at = now()
        where user_id = auth.uid();
      else
        v_token := public._ad_store_tokens('account', auth.uid(), v_response);
        v_request := net.http_get(url := 'https://api.autodarts.com/bs/v0/boards', headers := public._ad_headers(v_token), timeout_milliseconds := 10000);
        update public.autodarts_accounts set pending_request_id = v_request, pending_request_kind = 'boards', pending_request_at = now()
        where user_id = auth.uid();
        v_loading := true;
      end if;
    elsif v_row.pending_request_kind = 'boards' then
      update public.autodarts_accounts set pending_request_id = null, pending_request_kind = null,
        boards = case when v_status = 200 then public._ad_board_list(v_response) else boards end,
        boards_updated_at = case when v_status = 200 then now() else boards_updated_at end,
        -- first link: preselect the board that is online (or the only one)
        default_board_id = coalesce(default_board_id,
          (select b->>'id' from jsonb_array_elements(public._ad_board_list(v_response)) b
            order by (b->>'connected')::boolean desc limit 1)),
        updated_at = now()
      where user_id = auth.uid();
    end if;
    select * into v_row from public.autodarts_accounts where user_id = auth.uid();
  end if;

  return jsonb_build_object(
    'status', v_row.status,
    'loading', v_loading or v_row.pending_request_id is not null,
    'email', v_row.autodarts_email,
    'username', v_row.autodarts_username,
    'boards', v_row.boards,
    'boardsUpdatedAt', v_row.boards_updated_at,
    'defaultBoardId', v_row.default_board_id,
    'lastError', v_row.last_error
  );
end;
$function$;

create or replace function public.autodarts_account_set_board(p_board_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.autodarts_accounts set default_board_id = nullif(p_board_id, ''), updated_at = now() where user_id = auth.uid();
end;
$function$;

create or replace function public.autodarts_account_unlink()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from public.autodarts_accounts where user_id = auth.uid();
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- A fellow player confirms their own Autodarts login for one match (on the host's device)
-- ---------------------------------------------------------------------------------------------

create or replace function public.autodarts_player_login_start(p_email text, p_password text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club uuid := public._ad_caller_club();
  v_id uuid;
  v_request bigint;
begin
  if v_club is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;
  if coalesce(trim(p_email), '') = '' or coalesce(p_password, '') = '' then
    raise exception 'E-Mail und Passwort erforderlich';
  end if;
  delete from public.autodarts_player_logins where expires_at < now();
  v_request := net.http_post(
    url := 'https://api.autodarts.com/auth/v1/login',
    body := jsonb_build_object('username', trim(p_email), 'password', p_password, 'client_id', 'autodarts-play'),
    headers := public._ad_headers(),
    timeout_milliseconds := 20000
  );
  insert into public.autodarts_player_logins (club_id, created_by, autodarts_email, pending_request_id, pending_request_kind)
  values (v_club, auth.uid(), trim(p_email), v_request, 'login')
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.autodarts_player_login_status(p_login_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.autodarts_player_logins;
  v_status int;
  v_response jsonb;
begin
  select * into v_row from public.autodarts_player_logins where id = p_login_id and created_by = auth.uid() and expires_at > now();
  if v_row.id is null then
    return jsonb_build_object('status', 'expired');
  end if;
  if v_row.pending_request_id is not null then
    select r.status_code, public._ad_json(r.content)
      into v_status, v_response from net._http_response r where r.id = v_row.pending_request_id;
    if v_status is null then
      if now() - v_row.created_at > interval '45 seconds' then
        update public.autodarts_player_logins set status = 'error', pending_request_id = null,
          last_error = 'Autodarts hat nicht geantwortet -- bitte erneut versuchen' where id = v_row.id;
        return jsonb_build_object('status', 'error', 'lastError', 'Autodarts hat nicht geantwortet -- bitte erneut versuchen');
      end if;
      return jsonb_build_object('status', 'connecting');
    end if;
    if v_status <> 200 then
      update public.autodarts_player_logins set status = 'error', pending_request_id = null,
        last_error = 'Anmeldung fehlgeschlagen -- E-Mail oder Passwort pruefen' where id = v_row.id;
    else
      perform public._ad_store_tokens('login', v_row.id, v_response);
      update public.autodarts_player_logins set pending_request_id = null, pending_request_kind = null where id = v_row.id;
    end if;
    select * into v_row from public.autodarts_player_logins where id = p_login_id;
  end if;
  return jsonb_build_object('status', v_row.status, 'username', v_row.autodarts_username, 'email', v_row.autodarts_email, 'lastError', v_row.last_error);
end;
$function$;

create or replace function public.autodarts_player_login_remove(p_login_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  delete from public.autodarts_player_logins where id = p_login_id and created_by = auth.uid();
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- Sessions: one Autodarts lobby per Dartspot leg
-- ---------------------------------------------------------------------------------------------

-- p_host_kind 'account' = the caller's own linked account; 'board' = club board p_board_number.
-- p_players: ordered by this leg's throwing order, [{kind:'host'|'guest'|'login', name, login_id?}],
-- only the humans who throw at this board (bots and remote online opponents are left out).
create or replace function public.autodarts_session_start(
  p_host_kind text,
  p_board_number integer,
  p_base_score integer,
  p_double_out boolean,
  p_players jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club uuid := public._ad_caller_club();
  v_host_ref uuid;
  v_id uuid;
  v_player jsonb;
begin
  if v_club is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;
  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players) = 0 or jsonb_array_length(p_players) > 6 then
    raise exception 'Autodarts: 1 bis 6 Spieler erforderlich';
  end if;
  for v_player in select * from jsonb_array_elements(p_players) loop
    if v_player->>'kind' not in ('host', 'guest', 'login') then
      raise exception 'Autodarts: unbekannter Spielertyp';
    end if;
    if v_player->>'kind' = 'login' and not exists (
      select 1 from public.autodarts_player_logins l
       where l.id = (v_player->>'login_id')::uuid and l.created_by = auth.uid() and l.status = 'connected' and l.expires_at > now()
    ) then
      raise exception 'Autodarts: Login von % ist abgelaufen -- bitte erneut bestaetigen', coalesce(v_player->>'name', 'Mitspieler');
    end if;
  end loop;

  if p_host_kind = 'account' then
    if not exists (select 1 from public.autodarts_accounts where user_id = auth.uid() and refresh_token_ciphertext is not null) then
      raise exception 'Kein Autodarts-Konto verknuepft (Einstellungen > Konto)';
    end if;
    v_host_ref := auth.uid();
  elsif p_host_kind = 'board' then
    select id into v_host_ref from public.autodarts_boards where club_id = v_club and board_number = p_board_number and refresh_token_ciphertext is not null;
    if v_host_ref is null then
      raise exception 'Vereinsboard % ist nicht mit Autodarts verbunden', p_board_number;
    end if;
  else
    raise exception 'Autodarts: unbekannte Quelle';
  end if;

  delete from public.autodarts_sessions where created_by = auth.uid() and updated_at < now() - interval '1 day';

  insert into public.autodarts_sessions (club_id, created_by, host_kind, host_ref, base_score, double_out, players)
  values (v_club, auth.uid(), p_host_kind, v_host_ref, p_base_score, coalesce(p_double_out, true), p_players)
  returning id into v_id;
  return v_id;
end;
$function$;

-- Advances a starting session by at most one Autodarts call per invocation; the client calls it
-- about once a second until it returns 'live' or 'error'.
--   tokens  -> make sure host + every confirmed login has a fresh access token (refresh one at a time)
--   lobby   -> POST /gs/v0/lobbies (one leg)
--   boards  -> GET /bs/v0/boards, pick the board
--   player  -> POST /gs/v0/lobbies/{id}/players, once per player (a confirmed login adds ITSELF with its
--              own token, exactly like Autodarts' own "join"; if that is refused it is added as a guest)
--   start   -> POST /gs/v0/lobbies/{id}/start
create or replace function public.autodarts_session_step(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.autodarts_sessions;
  v_status int;
  v_response jsonb;
  v_request bigint;
  v_host_token text;
  v_token text;
  v_data jsonb;
  v_player jsonb;
  v_idx int;
  v_kind text;
  v_ref uuid;
  v_board_id text;
  v_board_name text;
  v_preferred text;
  v_body jsonb;
  v_name text;
  v_login public.autodarts_player_logins;
begin
  select * into s from public.autodarts_sessions where id = p_session_id and created_by = auth.uid();
  if s.id is null then
    return jsonb_build_object('status', 'error', 'message', 'Autodarts-Sitzung nicht gefunden');
  end if;
  if s.status <> 'starting' then
    return jsonb_build_object('status', s.status, 'message', s.last_error, 'matchId', s.lobby_id,
      'boardName', s.autodarts_board_name, 'warnings', s.warnings);
  end if;

  v_data := s.step_data;

  -- Waiting for the previous call?
  if s.pending_request_id is not null then
    select r.status_code, public._ad_json(r.content)
      into v_status, v_response from net._http_response r where r.id = s.pending_request_id;
    if v_status is null then
      if public._ad_request_lost(s.pending_request_id, s.pending_request_at) then
        update public.autodarts_sessions set status = 'error', last_error = 'Autodarts hat nicht geantwortet (' || s.step || ')', updated_at = now() where id = s.id;
        return jsonb_build_object('status', 'error', 'message', 'Autodarts hat nicht geantwortet');
      end if;
      return jsonb_build_object('status', 'pending', 'step', s.step);
    end if;

    -- Resolve the answer of the step that was waiting.
    if s.step = 'tokens' then
      if v_status <> 200 then
        update public.autodarts_sessions set status = 'error', updated_at = now(),
          last_error = case when v_data->>'cred_kind' = 'login'
                            then 'Autodarts-Login eines Mitspielers ist abgelaufen -- bitte erneut bestaetigen'
                            else 'Autodarts-Anmeldung abgelaufen -- bitte in den Einstellungen neu verbinden' end
        where id = s.id;
        if v_data->>'cred_kind' = 'account' then
          update public.autodarts_accounts set status = 'error', last_error = 'Anmeldung abgelaufen -- bitte neu verbinden' where user_id = (v_data->>'cred_ref')::uuid;
        end if;
        select * into s from public.autodarts_sessions where id = s.id;
        return jsonb_build_object('status', 'error', 'message', s.last_error);
      end if;
      perform public._ad_store_tokens(v_data->>'cred_kind', (v_data->>'cred_ref')::uuid, v_response);
    elsif s.step = 'lobby' then
      if v_status not in (200, 201) or v_response->>'id' is null then
        update public.autodarts_sessions set status = 'error', updated_at = now(),
          last_error = 'Autodarts-Lobby konnte nicht erstellt werden (' || coalesce(v_response->>'message', v_response->'error'->>'message', 'Status ' || v_status) || ')'
        where id = s.id;
        return jsonb_build_object('status', 'error', 'message', 'Autodarts-Lobby konnte nicht erstellt werden');
      end if;
      update public.autodarts_sessions set lobby_id = v_response->>'id', step = 'boards', pending_request_id = null where id = s.id;
    elsif s.step = 'boards' then
      if s.host_kind = 'account' then
        select default_board_id into v_preferred from public.autodarts_accounts where user_id = s.host_ref;
        update public.autodarts_accounts set boards = public._ad_board_list(v_response), boards_updated_at = now()
          where user_id = s.host_ref and v_status = 200;
      else
        select autodarts_board_id into v_preferred from public.autodarts_boards where id = s.host_ref;
      end if;
      select b->>'id', b->>'name' into v_board_id, v_board_name
        from jsonb_array_elements(public._ad_board_list(case when v_status = 200 then v_response else '[]'::jsonb end)) b
       where (b->>'connected')::boolean
       order by (b->>'id' is not distinct from v_preferred) desc, (b->>'type' = 'lens') asc
       limit 1;
      if v_board_id is null then
        update public.autodarts_sessions set status = 'error', updated_at = now(),
          last_error = 'Kein Autodarts-Board online -- bitte den Board Manager bzw. Autodarts Lens starten'
        where id = s.id;
        return jsonb_build_object('status', 'error', 'message', 'Kein Autodarts-Board online -- bitte den Board Manager bzw. Autodarts Lens starten');
      end if;
      update public.autodarts_sessions set autodarts_board_id = v_board_id, autodarts_board_name = v_board_name,
        step = 'player', step_data = jsonb_build_object('index', 0), pending_request_id = null where id = s.id;
    elsif s.step = 'player' then
      v_idx := coalesce((v_data->>'index')::int, 0);
      if v_status not in (200, 201, 204) then
        if coalesce((v_data->>'as_guest')::boolean, false) = false and s.players->v_idx->>'kind' = 'login' then
          -- Autodarts refused the player's own join (e.g. no permission on the host's board): retry as a guest.
          update public.autodarts_sessions set step_data = jsonb_build_object('index', v_idx, 'as_guest', true), pending_request_id = null,
            warnings = warnings || to_jsonb(coalesce(s.players->v_idx->>'name', 'Mitspieler') || ' spielt als Gast (Autodarts hat das Konto nicht zugelassen)')
          where id = s.id;
        else
          update public.autodarts_sessions set status = 'error', updated_at = now(),
            last_error = 'Spieler konnte nicht zur Autodarts-Lobby hinzugefuegt werden (' || coalesce(v_response->>'message', v_response->'error'->>'message', 'Status ' || v_status) || ')'
          where id = s.id;
          return jsonb_build_object('status', 'error', 'message', 'Spieler konnte nicht zur Autodarts-Lobby hinzugefuegt werden');
        end if;
      else
        update public.autodarts_sessions set step_data = jsonb_build_object('index', v_idx + 1), pending_request_id = null where id = s.id;
      end if;
    elsif s.step = 'start' then
      if v_status not in (200, 201, 204) then
        update public.autodarts_sessions set status = 'error', updated_at = now(),
          last_error = 'Autodarts-Spiel konnte nicht gestartet werden (' || coalesce(v_response->>'message', v_response->'error'->>'message', 'Status ' || v_status) || ')'
        where id = s.id;
        return jsonb_build_object('status', 'error', 'message', 'Autodarts-Spiel konnte nicht gestartet werden');
      end if;
      update public.autodarts_sessions set status = 'live', pending_request_id = null,
        pending_poll_request_id = null, pending_poll_kind = null, updated_at = now() where id = s.id;
      select * into s from public.autodarts_sessions where id = s.id;
      return jsonb_build_object('status', 'live', 'matchId', s.lobby_id, 'boardName', s.autodarts_board_name, 'warnings', s.warnings);
    end if;

    update public.autodarts_sessions set pending_request_id = null, updated_at = now() where id = s.id;
    select * into s from public.autodarts_sessions where id = s.id;
    v_data := s.step_data;
  end if;

  -- Fire the next call.
  if s.step = 'tokens' then
    -- host first, then each confirmed login, in order: refresh the first one without a valid token
    v_kind := null;
    if public._ad_cached_token(s.host_kind, s.host_ref) is null then
      v_kind := s.host_kind; v_ref := s.host_ref;
    else
      for v_player in select * from jsonb_array_elements(s.players) loop
        if v_player->>'kind' = 'login' and public._ad_cached_token('login', (v_player->>'login_id')::uuid) is null then
          v_kind := 'login'; v_ref := (v_player->>'login_id')::uuid;
          exit;
        end if;
      end loop;
    end if;
    if v_kind is not null then
      v_request := public._ad_enqueue_refresh(v_kind, v_ref);
      update public.autodarts_sessions set pending_request_id = v_request, pending_request_at = now(),
        step_data = jsonb_build_object('cred_kind', v_kind, 'cred_ref', v_ref), updated_at = now() where id = s.id;
      return jsonb_build_object('status', 'pending', 'step', 'tokens');
    end if;
    update public.autodarts_sessions set step = 'lobby', step_data = '{}'::jsonb where id = s.id;
    s.step := 'lobby';
  end if;

  v_host_token := public._ad_cached_token(s.host_kind, s.host_ref);
  if v_host_token is null then
    update public.autodarts_sessions set step = 'tokens', step_data = '{}'::jsonb, updated_at = now() where id = s.id;
    return jsonb_build_object('status', 'pending', 'step', 'tokens');
  end if;

  if s.step = 'lobby' then
    v_request := net.http_post(
      url := 'https://api.autodarts.com/gs/v0/lobbies',
      body := jsonb_build_object(
        'variant', 'X01', 'isPrivate', true, 'bullOffMode', 'Off',
        'settings', jsonb_build_object('baseScore', s.base_score, 'inMode', 'Straight',
          'outMode', case when s.double_out then 'Double' else 'Straight' end, 'maxRounds', 50, 'bullMode', '25/50'),
        'legs', 1
      ),
      headers := public._ad_headers(v_host_token),
      timeout_milliseconds := 15000
    );
  elsif s.step = 'boards' then
    v_request := net.http_get(url := 'https://api.autodarts.com/bs/v0/boards', headers := public._ad_headers(v_host_token), timeout_milliseconds := 10000);
  elsif s.step = 'player' then
    v_idx := coalesce((v_data->>'index')::int, 0);
    if v_idx >= jsonb_array_length(s.players) then
      update public.autodarts_sessions set step = 'start', step_data = '{}'::jsonb where id = s.id;
      v_request := net.http_post(url := 'https://api.autodarts.com/gs/v0/lobbies/' || s.lobby_id || '/start', body := '{}'::jsonb,
        headers := public._ad_headers(v_host_token), timeout_milliseconds := 15000);
      update public.autodarts_sessions set pending_request_id = v_request, pending_request_at = now(), updated_at = now() where id = s.id;
      return jsonb_build_object('status', 'pending', 'step', 'start');
    end if;
    v_player := s.players->v_idx;
    v_name := left(coalesce(nullif(trim(v_player->>'name'), ''), 'Spieler ' || (v_idx + 1)), 30);
    v_token := v_host_token;
    if v_player->>'kind' = 'host' then
      v_body := jsonb_build_object('name', coalesce(public._jwt_claim(v_host_token, 'preferred_username'), v_name),
        'userId', public._jwt_claim(v_host_token, 'sub'), 'boardId', s.autodarts_board_id);
    elsif v_player->>'kind' = 'login' and coalesce((v_data->>'as_guest')::boolean, false) = false then
      select * into v_login from public.autodarts_player_logins where id = (v_player->>'login_id')::uuid;
      v_token := public._ad_cached_token('login', v_login.id);
      v_body := jsonb_build_object('name', coalesce(v_login.autodarts_username, v_name), 'userId', v_login.autodarts_user_id,
        'boardId', s.autodarts_board_id);
    else
      v_body := jsonb_build_object('name', v_name, 'hostId', public._jwt_claim(v_host_token, 'sub'), 'boardId', s.autodarts_board_id);
    end if;
    v_request := net.http_post(url := 'https://api.autodarts.com/gs/v0/lobbies/' || s.lobby_id || '/players', body := v_body,
      headers := public._ad_headers(coalesce(v_token, v_host_token)), timeout_milliseconds := 10000);
  else
    return jsonb_build_object('status', 'error', 'message', 'Unbekannter Schritt: ' || s.step);
  end if;

  update public.autodarts_sessions set pending_request_id = v_request, pending_request_at = now(), updated_at = now() where id = s.id;
  return jsonb_build_object('status', 'pending', 'step', s.step);
end;
$function$;

-- Live polling: returns the previous tick's /gs/v0/matches/{id} body (or {status:'pending'}) and
-- fires the next request. Never raises on an Autodarts failure -- returns {status:'error'} -- so its
-- own bookkeeping is never rolled back.
create or replace function public.autodarts_session_poll(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '10000'
as $function$
declare
  s public.autodarts_sessions;
  v_status int;
  v_response jsonb;
  v_token text;
  v_request bigint;
begin
  select * into s from public.autodarts_sessions where id = p_session_id and created_by = auth.uid();
  if s.id is null or s.lobby_id is null then
    return jsonb_build_object('status', 'error', 'message', 'Autodarts-Sitzung nicht gefunden');
  end if;
  if s.status = 'finished' then
    return jsonb_build_object('status', 'error', 'message', 'Autodarts-Spiel ist beendet');
  end if;

  if s.pending_poll_request_id is not null then
    select r.status_code, public._ad_json(r.content)
      into v_status, v_response from net._http_response r where r.id = s.pending_poll_request_id;
    if v_status is null then
      if not public._ad_request_lost(s.pending_poll_request_id, s.pending_poll_at) then
        return jsonb_build_object('status', 'pending');
      end if;
      -- lost: fall through and fire a fresh one
    else
      update public.autodarts_sessions set pending_poll_request_id = null, pending_poll_kind = null where id = s.id;
      if s.pending_poll_kind = 'refresh' then
        if v_status <> 200 then
          return jsonb_build_object('status', 'error', 'message', 'Autodarts-Anmeldung abgelaufen, Status ' || v_status);
        end if;
        perform public._ad_store_tokens(s.host_kind, s.host_ref, v_response);
        v_response := null;  -- never hand the token answer to the client
      elsif v_status <> 200 then
        v_response := jsonb_build_object('status', 'error', 'message', 'Autodarts: Spielstand-Abfrage fehlgeschlagen, Status ' || v_status);
      end if;
    end if;
  end if;

  v_token := public._ad_cached_token(s.host_kind, s.host_ref);
  if v_token is not null then
    v_request := net.http_get(url := 'https://api.autodarts.com/gs/v0/matches/' || s.lobby_id,
      headers := public._ad_headers(v_token), timeout_milliseconds := 5000);
    update public.autodarts_sessions set pending_poll_request_id = v_request, pending_poll_kind = 'match_get', pending_poll_at = now(), updated_at = now() where id = s.id;
  else
    v_request := public._ad_enqueue_refresh(s.host_kind, s.host_ref);
    update public.autodarts_sessions set pending_poll_request_id = v_request, pending_poll_kind = 'refresh', pending_poll_at = now(), updated_at = now() where id = s.id;
  end if;

  if s.pending_poll_kind = 'match_get' and v_status is not null then
    return v_response;
  end if;
  return coalesce(v_response, jsonb_build_object('status', 'pending'));
end;
$function$;

-- Best-effort: closes the Autodarts match/lobby. Never raises.
create or replace function public.autodarts_session_finish(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.autodarts_sessions;
  v_token text;
begin
  select * into s from public.autodarts_sessions where id = p_session_id and created_by = auth.uid();
  if s.id is null or s.status = 'finished' then
    return;
  end if;
  update public.autodarts_sessions set status = 'finished', updated_at = now() where id = s.id;
  if s.lobby_id is null then
    return;
  end if;
  v_token := public._ad_cached_token(s.host_kind, s.host_ref);
  if v_token is null then
    return;
  end if;
  begin
    if s.status = 'live' then
      perform net.http_post(url := 'https://api.autodarts.com/gs/v0/matches/' || s.lobby_id || '/finish', body := '{}'::jsonb,
        headers := public._ad_headers(v_token), timeout_milliseconds := 8000);
    else
      perform net.http_delete(url := 'https://api.autodarts.com/gs/v0/lobbies/' || s.lobby_id,
        headers := public._ad_headers(v_token), timeout_milliseconds := 8000);
    end if;
  exception when others then
    null;
  end;
end;
$function$;

-- Which Autodarts sources the caller can pick in the game setup: their own account (if linked) and
-- the club's connected boards. No tokens.
create or replace function public.autodarts_my_sources()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_club uuid := public._ad_caller_club();
  v_account jsonb;
  v_boards jsonb;
begin
  select jsonb_build_object('status', a.status, 'username', a.autodarts_username,
           'boardName', (select b->>'name' from jsonb_array_elements(a.boards) b where b->>'id' = a.default_board_id limit 1))
    into v_account
    from public.autodarts_accounts a where a.user_id = auth.uid() and a.refresh_token_ciphertext is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'boardNumber', b.board_number, 'label', b.label, 'status', b.status) order by b.board_number), '[]'::jsonb)
    into v_boards
    from public.autodarts_boards b where b.club_id = v_club;
  return jsonb_build_object('account', v_account, 'clubBoards', v_boards);
end;
$function$;

do $grants$
declare
  f text;
begin
  foreach f in array array[
    'autodarts_account_link(text, text)', 'autodarts_account_reload_boards()', 'autodarts_account_status()',
    'autodarts_account_set_board(text)', 'autodarts_account_unlink()',
    'autodarts_player_login_start(text, text)', 'autodarts_player_login_status(uuid)', 'autodarts_player_login_remove(uuid)',
    'autodarts_session_start(text, integer, integer, boolean, jsonb)', 'autodarts_session_step(uuid)',
    'autodarts_session_poll(uuid)', 'autodarts_session_finish(uuid)', 'autodarts_my_sources()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$grants$;
