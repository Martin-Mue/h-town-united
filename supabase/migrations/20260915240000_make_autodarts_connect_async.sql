-- Repeated live failures today (statement_timeout bumps, polling-interval fixes, exception
-- isolation, browser-like headers, retrying the http_post itself) all treated the symptom the same
-- way: make autodarts_connect_board's own synchronous wait for pg_net a little more patient/robust.
-- None of them held up against a real login attempt. The actual architectural problem is the
-- synchronous wait itself -- a single PostgREST RPC call blocking for up to 45s on an inherently
-- asynchronous subsystem (pg_net enqueues a request; a background worker processes it on its own
-- schedule) is fragile no matter how the specific wait is tuned, and this project has no control
-- over pg_net's own worker timing.
--
-- Fix: stop waiting synchronously at all. autodarts_connect_board now only ENQUEUES the login
-- (net.http_post returns its request id immediately, no polling) and returns right away with
-- status 'connecting'. A new autodarts_check_connect_status function -- cheap, a handful of
-- indexed lookups, never calls net.http_post itself -- is polled by the client every ~1.5s (same
-- established pattern as autodarts_poll_match/AutodartsLiveScore.tsx already uses for live match
-- state) until the board's status resolves to 'connected' or 'error'. Neither function can ever
-- time out waiting on Autodarts anymore, because neither one waits on Autodarts synchronously.
alter table public.autodarts_boards
  add column if not exists pending_login_request_id bigint;

create or replace function public.autodarts_connect_board(
  p_board_number integer,
  p_label text,
  p_connection_mode text,
  p_cloud_email text,
  p_cloud_password text,
  p_local_board_id text,
  p_local_api_key text,
  p_local_ip text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_is_admin boolean;
  v_passphrase text;
  v_row_id uuid;
  v_request_id bigint;
  v_status text := 'connected';
begin
  perform set_config('darts.autodarts_internal_write', 'on', true);

  select ur.club_id, bool_or(ur.role = 'admin') into v_club_id, v_is_admin
    from public.user_roles ur where ur.user_id = auth.uid()
    group by ur.club_id;
  if v_club_id is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;
  if not v_is_admin then
    raise exception 'Nur Vereins-Admins koennen ein Autodarts-Board verbinden';
  end if;
  if p_board_number is null or p_board_number <= 0 then
    raise exception 'board_number (positive Ganzzahl) ist erforderlich';
  end if;
  if p_cloud_email is null and p_local_api_key is null then
    raise exception 'Cloud-E-Mail/Passwort und/oder lokaler API-Key erforderlich';
  end if;

  select decrypted_secret into v_passphrase from vault.decrypted_secrets where name = 'autodarts_token_encryption_key';
  if v_passphrase is null then
    raise exception 'Verschluesselungs-Schluessel nicht konfiguriert';
  end if;

  select id into v_row_id from public.autodarts_boards where club_id = v_club_id and board_number = p_board_number;
  if v_row_id is null then
    v_row_id := gen_random_uuid();
  end if;

  if p_cloud_email is not null and p_cloud_password is not null then
    v_status := 'connecting';
  end if;

  insert into public.autodarts_boards (id, club_id, board_number, label, connection_mode, local_ip, status, last_error, pending_login_request_id, updated_at)
  values (v_row_id, v_club_id, p_board_number, p_label, coalesce(p_connection_mode, 'local'), p_local_ip, v_status, null, null, now())
  on conflict (club_id, board_number) do update set
    label = coalesce(excluded.label, public.autodarts_boards.label),
    connection_mode = coalesce(excluded.connection_mode, public.autodarts_boards.connection_mode),
    local_ip = coalesce(excluded.local_ip, public.autodarts_boards.local_ip),
    status = excluded.status,
    last_error = null,
    pending_login_request_id = null,
    updated_at = now();

  if p_local_api_key is not null then
    update public.autodarts_boards
    set local_api_key_ciphertext = encode(extensions.pgp_sym_encrypt(p_local_api_key, v_passphrase), 'base64'),
        autodarts_board_id = coalesce(p_local_board_id, autodarts_board_id),
        updated_at = now()
    where id = v_row_id;
  end if;

  if p_cloud_email is not null and p_cloud_password is not null then
    -- Fire-and-forget: enqueues the request and returns its id immediately. The actual HTTP call
    -- and result are handled entirely by autodarts_check_connect_status below, never here.
    v_request_id := net.http_post(
      url := 'https://api.autodarts.com/auth/v1/login',
      body := jsonb_build_object('email', p_cloud_email, 'password', p_cloud_password, 'client_id', 'autodarts-play'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Origin', 'https://play.autodarts.com',
        'Referer', 'https://play.autodarts.com/',
        'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
        'Accept', 'application/json, text/plain, */*',
        'Accept-Language', 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
      ),
      timeout_milliseconds := 20000
    );
    update public.autodarts_boards
    set pending_login_request_id = v_request_id, autodarts_user_email = p_cloud_email, updated_at = now()
    where id = v_row_id;
  end if;

  return jsonb_build_object('status', v_status, 'boardNumber', p_board_number);
end;
$function$;

revoke all on function public.autodarts_connect_board(integer, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.autodarts_connect_board(integer, text, text, text, text, text, text, text) to authenticated;

-- Cheap, side-effect-light poll target: one row lookup, and (only once the background pg_net
-- request has actually resolved) one more update to persist the result. Never itself calls
-- net.http_post, never sleeps, never blocks -- safe to call every ~1.5s from the client for as
-- long as it takes, exactly like autodarts_poll_match already does for live match state.
create or replace function public.autodarts_check_connect_status(p_board_number integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_row record;
  v_passphrase text;
  v_login_status int;
  v_login_response jsonb;
  v_access_token text;
  v_refresh_token text;
  v_expires_in int;
  v_cloud_warning text;
begin
  select ur.club_id into v_club_id from public.user_roles ur where ur.user_id = auth.uid() limit 1;
  if v_club_id is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;

  select * into v_row from public.autodarts_boards where club_id = v_club_id and board_number = p_board_number;
  if v_row.id is null then
    raise exception 'Board nicht gefunden';
  end if;

  if v_row.pending_login_request_id is null then
    return jsonb_build_object('status', v_row.status, 'lastError', v_row.last_error);
  end if;

  select nr.status_code, nr.content::jsonb into v_login_status, v_login_response
    from net._http_response nr where nr.id = v_row.pending_login_request_id;

  if v_login_status is null then
    -- Not resolved yet -- pg_net's background worker hasn't gotten to it (or Autodarts itself
    -- hasn't answered yet). Tell the client to keep polling; nothing to write yet.
    return jsonb_build_object('status', 'connecting');
  end if;

  perform set_config('darts.autodarts_internal_write', 'on', true);

  begin
    if v_login_status <> 200 then
      raise exception 'Autodarts-Login fehlgeschlagen: %', coalesce(v_login_response->'error'->>'message', v_login_response->>'message', 'unbekannter Fehler, Status ' || v_login_status);
    end if;

    v_access_token := coalesce(v_login_response->>'accessToken', v_login_response->>'access_token');
    v_refresh_token := coalesce(v_login_response->>'refreshToken', v_login_response->>'refresh_token');
    v_expires_in := coalesce(nullif(v_login_response->>'expiresIn','')::int, nullif(v_login_response->>'expires_in','')::int, 900);

    if v_refresh_token is null then
      raise exception 'Unerwartetes Antwortformat -- gefundene Felder: %', (select string_agg(k, ', ') from jsonb_object_keys(v_login_response) as k);
    end if;

    select decrypted_secret into v_passphrase from vault.decrypted_secrets where name = 'autodarts_token_encryption_key';
    if v_passphrase is null then
      raise exception 'Verschluesselungs-Schluessel nicht konfiguriert';
    end if;

    update public.autodarts_boards
    set refresh_token_ciphertext = encode(extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase), 'base64'),
        access_token = v_access_token,
        access_token_expires_at = now() + make_interval(secs => v_expires_in),
        token_updated_at = now(),
        status = 'connected',
        last_error = null,
        pending_login_request_id = null,
        updated_at = now()
    where id = v_row.id;

    return jsonb_build_object('status', 'connected', 'accessToken', v_access_token, 'expiresIn', v_expires_in);
  exception when others then
    v_cloud_warning := sqlerrm;
    update public.autodarts_boards
    set status = 'error', last_error = v_cloud_warning, pending_login_request_id = null, updated_at = now()
    where id = v_row.id;
    return jsonb_build_object('status', 'error', 'lastError', v_cloud_warning);
  end;
end;
$function$;

revoke all on function public.autodarts_check_connect_status(integer) from public, anon;
grant execute on function public.autodarts_check_connect_status(integer) to authenticated;
