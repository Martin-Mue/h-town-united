-- Regression from the previous migration: rewriting autodarts_start_match/
-- autodarts_check_start_match_status/autodarts_poll_match into the async state machine dropped the
-- User-Agent/Accept/Accept-Language headers that every OTHER Autodarts call in this project has
-- always sent (see e.g. 20260915220000_add_browser_like_headers_to_autodarts_calls.sql). Live
-- result right after applying the previous migration: token refresh succeeded (proves the pg_net
-- fix itself works), but lobby creation came back 403 -- Autodarts' /gs/v0/ endpoints apparently
-- care about looking like a real browser request in a way /auth/v1/refresh doesn't. Restores the
-- full header set on every outbound call in these three functions, matching what already worked
-- before today's rewrite. No other logic changes.
create or replace function public.autodarts_start_match(
  p_board_number integer,
  p_base_score integer,
  p_double_out boolean,
  p_legs integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_board_id uuid;
  v_row record;
  v_cached_token text;
  v_request_id bigint;
  v_passphrase text;
  v_stored_refresh_token text;
  v_headers jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'Origin', 'https://play.autodarts.com',
    'Referer', 'https://play.autodarts.com/',
    'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'Accept', 'application/json, text/plain, */*',
    'Accept-Language', 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
  );
begin
  select ur.club_id into v_club_id from public.user_roles ur where ur.user_id = auth.uid() limit 1;
  if v_club_id is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;

  select * into v_row from public.autodarts_boards where club_id = v_club_id and board_number = p_board_number;
  if v_row.id is null then
    raise exception 'Board nicht verbunden';
  end if;
  v_board_id := v_row.id;

  perform set_config('darts.autodarts_internal_write', 'on', true);

  v_cached_token := public._autodarts_cached_token(v_board_id, v_club_id);

  if v_cached_token is not null then
    v_request_id := net.http_post(
      url := 'https://api.autodarts.com/gs/v0/lobbies',
      body := jsonb_build_object(
        'variant', 'X01', 'isPrivate', true, 'bullOffMode', 'Off',
        'settings', jsonb_build_object(
          'baseScore', p_base_score, 'inMode', 'Straight',
          'outMode', case when p_double_out then 'Double' else 'Straight' end,
          'maxRounds', 50, 'bullMode', '25/50'
        ),
        'legs', p_legs
      ),
      headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_cached_token),
      timeout_milliseconds := 15000
    );
    update public.autodarts_boards set pending_match_setup = jsonb_build_object(
      'step', 'lobby_create', 'request_id', v_request_id, 'access_token', v_cached_token
    ), updated_at = now() where id = v_board_id;
  else
    if v_row.refresh_token_ciphertext is null then
      raise exception 'Board hat keine Cloud-Anmeldung -- Cloud-Login fehlt';
    end if;
    select decrypted_secret into v_passphrase from vault.decrypted_secrets where name = 'autodarts_token_encryption_key';
    if v_passphrase is null then
      raise exception 'Verschluesselungs-Schluessel nicht konfiguriert';
    end if;
    v_stored_refresh_token := extensions.pgp_sym_decrypt(decode(v_row.refresh_token_ciphertext, 'base64'), v_passphrase);
    v_request_id := net.http_post(
      url := 'https://api.autodarts.com/auth/v1/refresh',
      body := jsonb_build_object('refresh_token', v_stored_refresh_token, 'client_id', 'autodarts-play'),
      headers := v_headers,
      timeout_milliseconds := 15000
    );
    update public.autodarts_boards set pending_match_setup = jsonb_build_object(
      'step', 'refresh', 'request_id', v_request_id
    ), updated_at = now() where id = v_board_id;
  end if;

  update public.autodarts_boards set pending_match_setup = pending_match_setup ||
    jsonb_build_object('base_score', p_base_score, 'double_out', p_double_out, 'legs', p_legs)
    where id = v_board_id;

  return jsonb_build_object('status', 'pending');
end;
$function$;

create or replace function public.autodarts_check_start_match_status(p_board_number integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_row record;
  v_state jsonb;
  v_status int;
  v_response jsonb;
  v_request_id bigint;
  v_passphrase text;
  v_access_token text;
  v_lobby_id text;
  v_host_user_id text;
  v_autoscoring_device_id text;
  v_headers jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'Origin', 'https://play.autodarts.com',
    'Referer', 'https://play.autodarts.com/',
    'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'Accept', 'application/json, text/plain, */*',
    'Accept-Language', 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
  );
begin
  select ur.club_id into v_club_id from public.user_roles ur where ur.user_id = auth.uid() limit 1;
  if v_club_id is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;

  select * into v_row from public.autodarts_boards where club_id = v_club_id and board_number = p_board_number;
  if v_row.id is null then
    raise exception 'Board nicht verbunden';
  end if;

  v_state := v_row.pending_match_setup;
  if v_state is null then
    return jsonb_build_object('status', 'error', 'message', 'Kein Spielstart in Arbeit');
  end if;

  select nr.status_code, nr.content::jsonb into v_status, v_response
    from net._http_response nr where nr.id = (v_state->>'request_id')::bigint;

  if v_status is null then
    return jsonb_build_object('status', 'pending');
  end if;

  perform set_config('darts.autodarts_internal_write', 'on', true);

  if v_state->>'step' = 'refresh' then
    if v_status <> 200 then
      update public.autodarts_boards set pending_match_setup = null, status = 'error',
        last_error = coalesce(v_response->'error'->>'message', v_response->>'message', 'Token-Aktualisierung fehlgeschlagen, Status ' || v_status),
        updated_at = now() where id = v_row.id;
      return jsonb_build_object('status', 'error', 'step', 'refresh', 'message', coalesce(v_response->'error'->>'message', v_response->>'message', 'Status ' || v_status));
    end if;

    v_access_token := coalesce(v_response->>'access_token', v_response->>'accessToken');
    select decrypted_secret into v_passphrase from vault.decrypted_secrets where name = 'autodarts_token_encryption_key';
    update public.autodarts_boards
      set refresh_token_ciphertext = encode(extensions.pgp_sym_encrypt(coalesce(v_response->>'refresh_token', v_response->>'refreshToken'), v_passphrase), 'base64'),
          access_token = v_access_token,
          access_token_expires_at = now() + make_interval(secs => coalesce(nullif(v_response->>'expires_in', '')::int, 300)),
          token_updated_at = now(), status = 'connected', last_error = null, updated_at = now()
      where id = v_row.id;

    v_request_id := net.http_post(
      url := 'https://api.autodarts.com/gs/v0/lobbies',
      body := jsonb_build_object(
        'variant', 'X01', 'isPrivate', true, 'bullOffMode', 'Off',
        'settings', jsonb_build_object(
          'baseScore', (v_state->>'base_score')::int, 'inMode', 'Straight',
          'outMode', case when (v_state->>'double_out')::boolean then 'Double' else 'Straight' end,
          'maxRounds', 50, 'bullMode', '25/50'
        ),
        'legs', (v_state->>'legs')::int
      ),
      headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_access_token),
      timeout_milliseconds := 15000
    );
    update public.autodarts_boards set pending_match_setup = jsonb_build_object(
      'step', 'lobby_create', 'request_id', v_request_id, 'access_token', v_access_token,
      'base_score', v_state->>'base_score', 'double_out', v_state->>'double_out', 'legs', v_state->>'legs'
    ), updated_at = now() where id = v_row.id;
    return jsonb_build_object('status', 'pending');
  end if;

  if v_state->>'step' = 'lobby_create' then
    if v_status not in (200, 201) then
      update public.autodarts_boards set pending_match_setup = null, updated_at = now() where id = v_row.id;
      return jsonb_build_object('status', 'error', 'step', 'lobby_create', 'message', coalesce(v_response->'error'->>'message', v_response->>'message', 'Status ' || v_status));
    end if;
    v_lobby_id := v_response->>'id';
    if v_lobby_id is null then
      update public.autodarts_boards set pending_match_setup = null, updated_at = now() where id = v_row.id;
      return jsonb_build_object('status', 'error', 'step', 'lobby_create', 'message', 'Lobby-Antwort ohne id');
    end if;
    v_access_token := v_state->>'access_token';
    v_request_id := net.http_get(
      url := 'https://api.autodarts.com/bs/v0/boards',
      headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_access_token),
      timeout_milliseconds := 8000
    );
    update public.autodarts_boards set pending_match_setup = jsonb_build_object(
      'step', 'boards_get', 'request_id', v_request_id, 'access_token', v_access_token, 'lobby_id', v_lobby_id
    ), updated_at = now() where id = v_row.id;
    return jsonb_build_object('status', 'pending');
  end if;

  if v_state->>'step' = 'boards_get' then
    v_access_token := v_state->>'access_token';
    v_lobby_id := v_state->>'lobby_id';
    if v_status = 200 and jsonb_typeof(v_response) = 'array' then
      select b->>'id' into v_autoscoring_device_id from jsonb_array_elements(v_response) b
        where b->>'deviceType' = 'lens' and coalesce((b->>'connected')::boolean, false) = true limit 1;
      if v_autoscoring_device_id is null then
        select b->>'id' into v_autoscoring_device_id from jsonb_array_elements(v_response) b
          where coalesce((b->>'connected')::boolean, false) = true limit 1;
      end if;
    end if;

    if v_autoscoring_device_id is null then
      v_request_id := net.http_post(
        url := 'https://api.autodarts.com/gs/v0/lobbies/' || v_lobby_id || '/start',
        body := '{}'::jsonb,
        headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_access_token),
        timeout_milliseconds := 15000
      );
      update public.autodarts_boards set pending_match_setup = jsonb_build_object(
        'step', 'lobby_start', 'request_id', v_request_id, 'lobby_id', v_lobby_id, 'autoscoring_device_id', null
      ), updated_at = now() where id = v_row.id;
      return jsonb_build_object('status', 'pending');
    end if;

    v_host_user_id := public._jwt_claim(v_access_token, 'sub');
    v_request_id := net.http_delete(
      url := 'https://api.autodarts.com/gs/v0/lobbies/' || v_lobby_id || '/players/by-userid/' || v_host_user_id,
      headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_access_token),
      timeout_milliseconds := 8000
    );
    update public.autodarts_boards set pending_match_setup = jsonb_build_object(
      'step', 'remove_host', 'request_id', v_request_id, 'access_token', v_access_token, 'lobby_id', v_lobby_id,
      'host_user_id', v_host_user_id, 'autoscoring_device_id', v_autoscoring_device_id
    ), updated_at = now() where id = v_row.id;
    return jsonb_build_object('status', 'pending');
  end if;

  if v_state->>'step' = 'remove_host' then
    v_access_token := v_state->>'access_token';
    v_lobby_id := v_state->>'lobby_id';
    v_request_id := net.http_post(
      url := 'https://api.autodarts.com/gs/v0/lobbies/' || v_lobby_id || '/players',
      body := jsonb_build_object('name', coalesce(public._jwt_claim(v_access_token, 'preferred_username'), 'Dartspot'), 'hostId', v_state->>'host_user_id', 'boardId', v_state->>'autoscoring_device_id'),
      headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_access_token),
      timeout_milliseconds := 8000
    );
    update public.autodarts_boards set pending_match_setup = jsonb_build_object(
      'step', 'add_player', 'request_id', v_request_id, 'access_token', v_access_token, 'lobby_id', v_lobby_id,
      'autoscoring_device_id', v_state->>'autoscoring_device_id'
    ), updated_at = now() where id = v_row.id;
    return jsonb_build_object('status', 'pending');
  end if;

  if v_state->>'step' = 'add_player' then
    v_access_token := v_state->>'access_token';
    v_lobby_id := v_state->>'lobby_id';
    v_request_id := net.http_post(
      url := 'https://api.autodarts.com/gs/v0/lobbies/' || v_lobby_id || '/start',
      body := '{}'::jsonb,
      headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_access_token),
      timeout_milliseconds := 15000
    );
    update public.autodarts_boards set pending_match_setup = jsonb_build_object(
      'step', 'lobby_start', 'request_id', v_request_id, 'lobby_id', v_lobby_id,
      'autoscoring_device_id', v_state->>'autoscoring_device_id'
    ), updated_at = now() where id = v_row.id;
    return jsonb_build_object('status', 'pending');
  end if;

  if v_state->>'step' = 'lobby_start' then
    v_lobby_id := v_state->>'lobby_id';
    update public.autodarts_boards set pending_match_setup = null, updated_at = now() where id = v_row.id;
    if v_status not in (200, 201, 204) then
      return jsonb_build_object('status', 'error', 'step', 'lobby_start', 'message', 'Lobby-Start fehlgeschlagen, Status ' || v_status);
    end if;
    return jsonb_build_object('status', 'connected', 'matchId', v_lobby_id, 'autoscoringDeviceId', v_state->>'autoscoring_device_id');
  end if;

  return jsonb_build_object('status', 'error', 'message', 'Unbekannter Schritt: ' || coalesce(v_state->>'step', '?'));
end;
$function$;

create or replace function public.autodarts_poll_match(p_board_number integer, p_match_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '10000'
as $function$
declare
  v_club_id uuid;
  v_row record;
  v_status int;
  v_response jsonb;
  v_request_id bigint;
  v_access_token text;
  v_passphrase text;
  v_stored_refresh_token text;
  v_headers jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'Origin', 'https://play.autodarts.com',
    'Referer', 'https://play.autodarts.com/',
    'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'Accept', 'application/json, text/plain, */*',
    'Accept-Language', 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
  );
begin
  select ur.club_id into v_club_id from public.user_roles ur where ur.user_id = auth.uid() limit 1;
  if v_club_id is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;

  select * into v_row from public.autodarts_boards where club_id = v_club_id and board_number = p_board_number;
  if v_row.id is null then
    raise exception 'Board nicht verbunden';
  end if;

  if v_row.pending_poll_request_id is not null then
    select nr.status_code, nr.content::jsonb into v_status, v_response
      from net._http_response nr where nr.id = v_row.pending_poll_request_id;

    if v_status is null then
      return jsonb_build_object('status', 'pending');
    end if;

    perform set_config('darts.autodarts_internal_write', 'on', true);

    if v_row.pending_poll_kind = 'refresh' then
      update public.autodarts_boards set pending_poll_request_id = null, pending_poll_kind = null, updated_at = now() where id = v_row.id;
      if v_status <> 200 then
        raise exception 'Autodarts: Token-Aktualisierung fehlgeschlagen, Status %', v_status;
      end if;
      select decrypted_secret into v_passphrase from vault.decrypted_secrets where name = 'autodarts_token_encryption_key';
      update public.autodarts_boards
        set refresh_token_ciphertext = encode(extensions.pgp_sym_encrypt(coalesce(v_response->>'refresh_token', v_response->>'refreshToken'), v_passphrase), 'base64'),
            access_token = coalesce(v_response->>'access_token', v_response->>'accessToken'),
            access_token_expires_at = now() + make_interval(secs => coalesce(nullif(v_response->>'expires_in', '')::int, 300)),
            token_updated_at = now(), updated_at = now()
        where id = v_row.id;
      return jsonb_build_object('status', 'pending');
    else
      update public.autodarts_boards set pending_poll_request_id = null, pending_poll_kind = null, updated_at = now() where id = v_row.id;
      if v_status <> 200 then
        raise exception 'Autodarts: Spielstand-Abfrage fehlgeschlagen, Status %', v_status;
      end if;
      v_access_token := public._autodarts_cached_token(v_row.id, v_club_id);
      if v_access_token is not null then
        v_request_id := net.http_get(
          url := 'https://api.autodarts.com/gs/v0/matches/' || p_match_id,
          headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_access_token),
          timeout_milliseconds := 5000
        );
        update public.autodarts_boards set pending_poll_request_id = v_request_id, pending_poll_kind = 'match_get', updated_at = now() where id = v_row.id;
      end if;
      return v_response;
    end if;
  end if;

  perform set_config('darts.autodarts_internal_write', 'on', true);
  v_access_token := public._autodarts_cached_token(v_row.id, v_club_id);
  if v_access_token is not null then
    v_request_id := net.http_get(
      url := 'https://api.autodarts.com/gs/v0/matches/' || p_match_id,
      headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_access_token),
      timeout_milliseconds := 5000
    );
    update public.autodarts_boards set pending_poll_request_id = v_request_id, pending_poll_kind = 'match_get', updated_at = now() where id = v_row.id;
  else
    if v_row.refresh_token_ciphertext is null then
      raise exception 'Board hat keine Cloud-Anmeldung';
    end if;
    select decrypted_secret into v_passphrase from vault.decrypted_secrets where name = 'autodarts_token_encryption_key';
    v_stored_refresh_token := extensions.pgp_sym_decrypt(decode(v_row.refresh_token_ciphertext, 'base64'), v_passphrase);
    v_request_id := net.http_post(
      url := 'https://api.autodarts.com/auth/v1/refresh',
      body := jsonb_build_object('refresh_token', v_stored_refresh_token, 'client_id', 'autodarts-play'),
      headers := v_headers,
      timeout_milliseconds := 8000
    );
    update public.autodarts_boards set pending_poll_request_id = v_request_id, pending_poll_kind = 'refresh', updated_at = now() where id = v_row.id;
  end if;
  return jsonb_build_object('status', 'pending');
end;
$function$;
