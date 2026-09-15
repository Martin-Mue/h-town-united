-- Real implementation of Autodarts cloud login/refresh, as Postgres functions rather than a
-- Supabase Edge Function. Reason: this project runs on Lovable Cloud, which has no self-service
-- Edge Function deploy path (only Lovable's own paid AI agent can push one live), and that
-- account's monthly credits were exhausted when this was built with no reset for weeks. pg_net
-- lets Postgres itself make the outbound HTTPS call to Autodarts -- server-side, so none of this
-- depends on the browser CORS restrictions a direct client-side call would hit.
--
-- Every URL/field name below was verified live (2026-09-15) against real DevTools captures of the
-- actual Autodarts web app (https://play.autodarts.com) -- not guessed from the old community
-- reverse-engineering docs referenced in autodartsClient.ts's earlier history, which turned out to
-- describe a since-migrated API generation (api.autodarts.io + Keycloak, both stale). Only the
-- refresh endpoint path (/auth/v1/refresh) remains an educated guess, not live-confirmed -- see
-- autodarts_refresh_board's own handling of a non-200 response.
create extension if not exists http with schema extensions;

-- The AES passphrase itself is a Supabase Vault secret (extension already present on this
-- project), NOT committed here -- see vault.create_secret, run once manually with a freshly
-- generated random value:
--   select vault.create_secret(<random base64>, 'autodarts_token_encryption_key', '...');
-- pgcrypto (also already present) does the actual pgp_sym_encrypt/pgp_sym_decrypt.

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
  v_login_response jsonb;
  v_login_status int;
  v_access_token text;
  v_refresh_token text;
  v_expires_in int;
  v_request_id bigint;
  v_err_message text;
  v_poll_attempt int;
begin
  -- Lets this function's own writes to the sensitive columns below past
  -- restrict_autodarts_board_credential_edits (see the follow-up migration that introduced this
  -- flag) -- that trigger otherwise blocks any write carrying a real auth.uid(), which this RPC
  -- legitimately does (it's called by a real logged-in admin, not a service-role backend).
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

  -- Non-secret fields first, so a bad cloud password below still leaves whatever WAS valid saved
  -- (e.g. a local API key entered in the same submit) rather than an all-or-nothing failure.
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
    -- Confirmed live: POST https://api.autodarts.com/auth/v1/login, plain JSON body
    -- {email, password, client_id}, client_id "autodarts-play" (NOT the old Keycloak
    -- "autodarts-app"). Origin/Referer are NOT optional -- the API's CORS/client validation
    -- rejects "autodarts-play" as an "unknown client_id" without them, confirmed live by testing
    -- with and without.
    v_request_id := net.http_post(
      url := 'https://api.autodarts.com/auth/v1/login',
      body := jsonb_build_object('email', p_cloud_email, 'password', p_cloud_password, 'client_id', 'autodarts-play'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
      timeout_milliseconds := 8000
    );
    -- Polls net._http_response every 300ms instead of one fixed sleep -- pg_net's background
    -- worker writes the row whenever the request actually finishes, which real-credential logins
    -- (server-side password hashing/verification takes real time) showed varies noticeably more
    -- than the throwaway wrong-credential probes this was originally tuned against; a fixed 2s
    -- sleep was too short and surfaced as a false "Netzwerk-Timeout" even though the request itself
    -- was still in flight, well inside the 8s timeout_milliseconds ceiling above.
    for v_poll_attempt in 1..27 loop
      select status_code, content::jsonb into v_login_status, v_login_response
        from net._http_response where id = v_request_id;
      exit when v_login_status is not null;
      perform pg_sleep(0.3);
    end loop;

    if v_login_status is null then
      update public.autodarts_boards set status = 'error', last_error = 'Autodarts-Login: keine Antwort (Timeout)', updated_at = now() where id = v_row_id;
      raise exception 'Autodarts-Login: keine Antwort erhalten (Netzwerk-Timeout)';
    end if;

    if v_login_status <> 200 then
      v_err_message := coalesce(v_login_response->'error'->>'message', 'unbekannter Fehler, Status ' || v_login_status);
      update public.autodarts_boards set status = 'error', last_error = v_err_message, updated_at = now() where id = v_row_id;
      raise exception 'Autodarts-Login fehlgeschlagen: %', v_err_message;
    end if;

    -- Every other confirmed-live Autodarts response uses camelCase (createdAt, isPrivate,
    -- gameFinished, ...) -- coalescing both casings costs nothing and protects against the one
    -- casing guess being wrong for this specific endpoint.
    v_access_token := coalesce(v_login_response->>'accessToken', v_login_response->>'access_token');
    v_refresh_token := coalesce(v_login_response->>'refreshToken', v_login_response->>'refresh_token');
    v_expires_in := coalesce(nullif(v_login_response->>'expiresIn','')::int, nullif(v_login_response->>'expires_in','')::int, 900);

    if v_refresh_token is null then
      v_err_message := 'Unerwartetes Antwortformat -- gefundene Felder: ' || (select string_agg(k, ', ') from jsonb_object_keys(v_login_response) as k);
      update public.autodarts_boards set status = 'error', last_error = v_err_message, updated_at = now() where id = v_row_id;
      raise exception '%', v_err_message;
    end if;

    update public.autodarts_boards
    set refresh_token_ciphertext = encode(extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase), 'base64'),
        autodarts_user_email = p_cloud_email,
        token_updated_at = now(),
        updated_at = now()
    where id = v_row_id;
  end if;

  return jsonb_build_object('status', 'connected', 'boardNumber', p_board_number, 'accessToken', v_access_token, 'expiresIn', v_expires_in);
end;
$function$;

revoke all on function public.autodarts_connect_board(integer, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.autodarts_connect_board(integer, text, text, text, text, text, text, text) to authenticated;

create or replace function public.autodarts_refresh_board(p_board_number integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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
  v_request_id bigint;
  v_result jsonb := '{}'::jsonb;
  v_local_api_key text;
  v_poll_attempt int;
begin
  perform set_config('darts.autodarts_internal_write', 'on', true);

  select ur.club_id into v_club_id from public.user_roles ur where ur.user_id = auth.uid() limit 1;
  if v_club_id is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;

  -- Any club member, not admin-only -- same reasoning as the camera feature: whoever is standing
  -- at the board should be able to use it.
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

    -- UNVERIFIED path/shape (unlike /auth/v1/login, this one was never observed live) -- if
    -- Autodarts' actual refresh contract differs, this fails into the else-branch below (status
    -- recorded as 'error', local credentials -- if any -- still returned) rather than crashing the
    -- whole call or silently corrupting the stored token.
    v_request_id := net.http_post(
      url := 'https://api.autodarts.com/auth/v1/refresh',
      body := jsonb_build_object('refreshToken', v_stored_refresh_token, 'client_id', 'autodarts-play'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
      timeout_milliseconds := 8000
    );
    for v_poll_attempt in 1..27 loop
      select status_code, content::jsonb into v_refresh_status, v_refresh_response from net._http_response where id = v_request_id;
      exit when v_refresh_status is not null;
      perform pg_sleep(0.3);
    end loop;

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
        last_error = coalesce(v_refresh_response->'error'->>'message', 'Refresh fehlgeschlagen, Status ' || coalesce(v_refresh_status::text, 'timeout')),
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
