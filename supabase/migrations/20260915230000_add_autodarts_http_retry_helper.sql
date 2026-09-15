-- pg_net's net.http_post is async: it enqueues the request and returns immediately with an id, and
-- a SEPARATE background worker performs the actual HTTP call and inserts the result row into
-- net._http_response whenever it gets around to it. A live diagnostic during this integration's own
-- debugging (real email + a deliberately wrong password, run directly by the project owner) proved
-- Autodarts itself responds fast and correctly (401 invalid_credentials in well under a second,
-- confirmed via net._http_response) -- ruling out network blocking or bot-protection as the cause of
-- an earlier live "Netzwerk-Timeout" (P0001) failure on a real login attempt. The remaining plausible
-- explanation: on a day with dozens of manual test calls, pg_net's own background worker can fall
-- behind and simply not get to a specific queued request within our ~21s polling window, even though
-- the eventual real HTTP call (once the worker picks it up) is fast -- our poll loop gives up and
-- reports a timeout for a request that was never actually slow, just delayed in the local queue.
--
-- Fix: retry the http_post itself (not just the poll) once before reporting a real timeout. Extracted
-- into a shared internal helper (previously this exact request+poll pattern was duplicated three
-- times across autodarts_connect_board/autodarts_refresh_board/_autodarts_get_access_token with no
-- retry at all) so the retry logic exists in exactly one place.
create or replace function public._autodarts_http_post_polled(
  p_url text,
  p_body jsonb,
  p_headers jsonb,
  p_timeout_ms int default 20000,
  p_poll_attempts int default 70,
  p_retry_count int default 2
)
returns table(status_code int, content jsonb)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request_id bigint;
  v_status int;
  v_content jsonb;
  v_attempt int;
  v_poll_attempt int;
begin
  for v_attempt in 1..greatest(p_retry_count, 1) loop
    v_request_id := net.http_post(url := p_url, body := p_body, headers := p_headers, timeout_milliseconds := p_timeout_ms);
    v_status := null;
    for v_poll_attempt in 1..p_poll_attempts loop
      select nr.status_code, nr.content::jsonb into v_status, v_content from net._http_response nr where nr.id = v_request_id;
      exit when v_status is not null;
      perform pg_sleep(0.3);
    end loop;
    exit when v_status is not null;
  end loop;
  status_code := v_status;
  content := v_content;
  return next;
end;
$function$;

revoke all on function public._autodarts_http_post_polled(text, jsonb, jsonb, int, int, int) from public, anon, authenticated;

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
set statement_timeout to '45000'
as $function$
declare
  v_club_id uuid;
  v_is_admin boolean;
  v_passphrase text;
  v_row_id uuid;
  v_login_response jsonb;
  v_login_status int;
  v_access_token text;
  v_refresh_token text;
  v_expires_in int;
  v_cloud_warning text;
  v_browser_headers jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'Origin', 'https://play.autodarts.com',
    'Referer', 'https://play.autodarts.com/',
    'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'Accept', 'application/json, text/plain, */*',
    'Accept-Language', 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
  );
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

  insert into public.autodarts_boards (id, club_id, board_number, label, connection_mode, local_ip, status, last_error, updated_at)
  values (v_row_id, v_club_id, p_board_number, p_label, coalesce(p_connection_mode, 'local'), p_local_ip, 'connected', null, now())
  on conflict (club_id, board_number) do update set
    label = coalesce(excluded.label, public.autodarts_boards.label),
    connection_mode = coalesce(excluded.connection_mode, public.autodarts_boards.connection_mode),
    local_ip = coalesce(excluded.local_ip, public.autodarts_boards.local_ip),
    status = 'connected',
    last_error = null,
    updated_at = now();

  if p_local_api_key is not null then
    update public.autodarts_boards
    set local_api_key_ciphertext = encode(extensions.pgp_sym_encrypt(p_local_api_key, v_passphrase), 'base64'),
        autodarts_board_id = coalesce(p_local_board_id, autodarts_board_id),
        updated_at = now()
    where id = v_row_id;
  end if;

  if p_cloud_email is not null and p_cloud_password is not null then
    begin
      select h.status_code, h.content into v_login_status, v_login_response
      from public._autodarts_http_post_polled(
        'https://api.autodarts.com/auth/v1/login',
        jsonb_build_object('email', p_cloud_email, 'password', p_cloud_password, 'client_id', 'autodarts-play'),
        v_browser_headers
      ) h;

      if v_login_status is null then
        raise exception 'Autodarts-Login: keine Antwort erhalten (Netzwerk-Timeout, auch nach Wiederholung)';
      end if;

      if v_login_status <> 200 then
        raise exception 'Autodarts-Login fehlgeschlagen: %', coalesce(v_login_response->'error'->>'message', v_login_response->>'message', 'unbekannter Fehler, Status ' || v_login_status);
      end if;

      v_access_token := coalesce(v_login_response->>'accessToken', v_login_response->>'access_token');
      v_refresh_token := coalesce(v_login_response->>'refreshToken', v_login_response->>'refresh_token');
      v_expires_in := coalesce(nullif(v_login_response->>'expiresIn','')::int, nullif(v_login_response->>'expires_in','')::int, 900);

      if v_refresh_token is null then
        raise exception 'Unerwartetes Antwortformat -- gefundene Felder: %', (select string_agg(k, ', ') from jsonb_object_keys(v_login_response) as k);
      end if;

      update public.autodarts_boards
      set refresh_token_ciphertext = encode(extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase), 'base64'),
          autodarts_user_email = p_cloud_email,
          token_updated_at = now(),
          status = 'connected',
          last_error = null,
          updated_at = now()
      where id = v_row_id;
    exception when others then
      v_cloud_warning := sqlerrm;
      update public.autodarts_boards set status = 'error', last_error = v_cloud_warning, updated_at = now() where id = v_row_id;
    end;
  end if;

  return jsonb_build_object(
    'status', 'connected',
    'boardNumber', p_board_number,
    'accessToken', v_access_token,
    'expiresIn', v_expires_in,
    'credentialsWarning', v_cloud_warning
  );
end;
$function$;

revoke all on function public.autodarts_connect_board(integer, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.autodarts_connect_board(integer, text, text, text, text, text, text, text) to authenticated;

create or replace function public.autodarts_refresh_board(p_board_number integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '45000'
as $function$
declare
  v_club_id uuid;
  v_row record;
  v_passphrase text;
  v_stored_refresh_token text;
  v_refresh_response jsonb;
  v_refresh_status int;
  v_access_token text;
  v_new_refresh_token text;
  v_expires_in int;
  v_result jsonb := '{}'::jsonb;
  v_local_api_key text;
  v_browser_headers jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'Origin', 'https://play.autodarts.com',
    'Referer', 'https://play.autodarts.com/',
    'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'Accept', 'application/json, text/plain, */*',
    'Accept-Language', 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
  );
begin
  perform set_config('darts.autodarts_internal_write', 'on', true);

  select ur.club_id into v_club_id from public.user_roles ur where ur.user_id = auth.uid() limit 1;
  if v_club_id is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;

  select * into v_row from public.autodarts_boards where club_id = v_club_id and board_number = p_board_number;
  if v_row.id is null then
    raise exception 'Board nicht verbunden';
  end if;

  select decrypted_secret into v_passphrase from vault.decrypted_secrets where name = 'autodarts_token_encryption_key';
  if v_passphrase is null then
    raise exception 'Verschluesselungs-Schluessel nicht konfiguriert';
  end if;

  if v_row.refresh_token_ciphertext is not null then
    v_stored_refresh_token := extensions.pgp_sym_decrypt(decode(v_row.refresh_token_ciphertext, 'base64'), v_passphrase);

    select h.status_code, h.content into v_refresh_status, v_refresh_response
    from public._autodarts_http_post_polled(
      'https://api.autodarts.com/auth/v1/refresh',
      jsonb_build_object('refreshToken', v_stored_refresh_token, 'client_id', 'autodarts-play'),
      v_browser_headers
    ) h;

    if v_refresh_status = 200 then
      v_access_token := coalesce(v_refresh_response->>'accessToken', v_refresh_response->>'access_token');
      v_new_refresh_token := coalesce(v_refresh_response->>'refreshToken', v_refresh_response->>'refresh_token', v_stored_refresh_token);
      v_expires_in := coalesce(nullif(v_refresh_response->>'expiresIn','')::int, nullif(v_refresh_response->>'expires_in','')::int, 900);

      update public.autodarts_boards
      set refresh_token_ciphertext = encode(extensions.pgp_sym_encrypt(v_new_refresh_token, v_passphrase), 'base64'),
          token_updated_at = now(), status = 'connected', last_error = null, updated_at = now()
      where id = v_row.id;

      v_result := jsonb_build_object('cloud', jsonb_build_object('accessToken', v_access_token, 'expiresIn', v_expires_in));
    else
      update public.autodarts_boards set status = 'error',
        last_error = coalesce(v_refresh_response->'error'->>'message', v_refresh_response->>'message', 'Refresh fehlgeschlagen, Status ' || coalesce(v_refresh_status::text, 'timeout')),
        updated_at = now()
      where id = v_row.id;
    end if;
  end if;

  if v_row.local_api_key_ciphertext is not null then
    v_local_api_key := extensions.pgp_sym_decrypt(decode(v_row.local_api_key_ciphertext, 'base64'), v_passphrase);
    v_result := v_result || jsonb_build_object('local', jsonb_build_object('apiKey', v_local_api_key, 'boardId', v_row.autodarts_board_id, 'ip', v_row.local_ip));
  end if;

  if v_result = '{}'::jsonb then
    raise exception 'Weder Cloud- noch lokale Zugangsdaten fuer dieses Board verfuegbar';
  end if;

  return jsonb_build_object('status', 'connected') || v_result;
end;
$function$;

revoke all on function public.autodarts_refresh_board(integer) from public, anon;
grant execute on function public.autodarts_refresh_board(integer) to authenticated;

create or replace function public._autodarts_get_access_token(p_board_id uuid, p_club_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '45000'
as $function$
declare
  v_passphrase text;
  v_row record;
  v_stored_refresh_token text;
  v_refresh_response jsonb;
  v_refresh_status int;
  v_access_token text;
  v_new_refresh_token text;
  v_expires_in int;
  v_browser_headers jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'Origin', 'https://play.autodarts.com',
    'Referer', 'https://play.autodarts.com/',
    'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'Accept', 'application/json, text/plain, */*',
    'Accept-Language', 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
  );
begin
  perform set_config('darts.autodarts_internal_write', 'on', true);

  select * into v_row from public.autodarts_boards where id = p_board_id and club_id = p_club_id;
  if v_row.id is null then
    raise exception 'Board nicht gefunden';
  end if;

  if v_row.access_token is not null and v_row.access_token_expires_at is not null
     and v_row.access_token_expires_at > now() + interval '60 seconds' then
    return v_row.access_token;
  end if;

  if v_row.refresh_token_ciphertext is null then
    raise exception 'Board hat keine Cloud-Anmeldung -- Cloud-Login fehlt';
  end if;

  select decrypted_secret into v_passphrase from vault.decrypted_secrets where name = 'autodarts_token_encryption_key';
  if v_passphrase is null then
    raise exception 'Verschluesselungs-Schluessel nicht konfiguriert';
  end if;

  v_stored_refresh_token := extensions.pgp_sym_decrypt(decode(v_row.refresh_token_ciphertext, 'base64'), v_passphrase);

  select h.status_code, h.content into v_refresh_status, v_refresh_response
  from public._autodarts_http_post_polled(
    'https://api.autodarts.com/auth/v1/refresh',
    jsonb_build_object('refreshToken', v_stored_refresh_token, 'client_id', 'autodarts-play'),
    v_browser_headers
  ) h;

  if v_refresh_status is null or v_refresh_status <> 200 then
    update public.autodarts_boards set status = 'error',
      last_error = coalesce(v_refresh_response->'error'->>'message', v_refresh_response->>'message', 'Token-Aktualisierung fehlgeschlagen, Status ' || coalesce(v_refresh_status::text, 'timeout')),
      updated_at = now()
    where id = v_row.id;
    raise exception 'Autodarts-Token-Aktualisierung fehlgeschlagen: %', coalesce(v_refresh_response->'error'->>'message', v_refresh_response->>'message', 'Status ' || coalesce(v_refresh_status::text, 'timeout'));
  end if;

  v_access_token := coalesce(v_refresh_response->>'accessToken', v_refresh_response->>'access_token');
  v_new_refresh_token := coalesce(v_refresh_response->>'refreshToken', v_refresh_response->>'refresh_token', v_stored_refresh_token);
  v_expires_in := coalesce(nullif(v_refresh_response->>'expiresIn','')::int, nullif(v_refresh_response->>'expires_in','')::int, 300);

  update public.autodarts_boards
  set refresh_token_ciphertext = encode(extensions.pgp_sym_encrypt(v_new_refresh_token, v_passphrase), 'base64'),
      access_token = v_access_token,
      access_token_expires_at = now() + make_interval(secs => v_expires_in),
      token_updated_at = now(), status = 'connected', last_error = null, updated_at = now()
  where id = v_row.id;

  return v_access_token;
end;
$function$;
