-- Autodarts: first real test with a 3-camera board (2026-11-14) -- connect + lobby start
-- succeeded, but no throw ever reached Dartspot. Two server-side causes, both seen in the live data:
-- 1) Device pick read fields that /bs/v0/boards doesn't have ("deviceType", top-level "connected";
--    real ones are "type" and "state.connected"), so the player was always added with boardId null
--    and the board never joined the match.
-- 2) autodarts_poll_match waited on pending_poll_request_id 165 left over from an earlier session,
--    whose response pg_net had long purged -> 'pending' forever, no match GET was ever sent.
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

  -- Always proceeds to remove_host -> add_player next, regardless of whether a device was found --
  -- adding the host as a real player is mandatory (an empty/bots-only lobby can't be started at
  -- all), autoscoring attachment is a separate, optional bonus on top of that same call.
  if v_state->>'step' = 'boards_get' then
    v_access_token := v_state->>'access_token';
    v_lobby_id := v_state->>'lobby_id';
    if v_status = 200 and jsonb_typeof(v_response) = 'array' then
      -- Real /bs/v0/boards shape (captured live 2026-11-14): the device kind is "type"
      -- (lens|vantage|link|...) and the online flag is nested at state.connected -- NOT the
      -- top-level "deviceType"/"connected" this used to read, which never matched anything, so
      -- every lobby got a player with boardId null and no board ever scored into it.
      -- Preference: the pinned board if it is online, else any online camera board, else any
      -- online device ("link" entries are app links, not cameras -- last resort only).
      select b->>'id' into v_autoscoring_device_id
        from jsonb_array_elements(v_response) b
        where coalesce((b->'state'->>'connected')::boolean, (b->>'connected')::boolean, false)
        order by (b->>'id' is not distinct from v_row.autodarts_board_id) desc,
                 (coalesce(b->>'type', b->>'deviceType') = 'link') asc,
                 coalesce((b->>'detections')::int, 0) desc
        limit 1;
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

  -- add_player's own outcome is checked now (unlike before) -- if adding the host failed, the
  -- lobby is still empty and starting it would only reproduce the same "only bots" 403, so surface
  -- the real error here instead of one more confusing hop.
  if v_state->>'step' = 'add_player' then
    v_access_token := v_state->>'access_token';
    v_lobby_id := v_state->>'lobby_id';
    if v_status not in (200, 201) then
      update public.autodarts_boards set pending_match_setup = null, updated_at = now() where id = v_row.id;
      return jsonb_build_object('status', 'error', 'step', 'add_player', 'message', coalesce(v_response->'error'->>'message', v_response->>'message', 'Status ' || v_status));
    end if;
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
    -- Also drop any poll request left over from an earlier match: its response may already be
    -- purged from net._http_response, and autodarts_poll_match would then wait on it forever.
    update public.autodarts_boards set pending_match_setup = null, pending_poll_request_id = null, pending_poll_kind = null, updated_at = now() where id = v_row.id;
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
      -- Still queued or in flight -> keep waiting. Neither queued nor answered -> the response was
      -- purged (pg_net keeps them only a few hours) or the request was lost: forget it and fire a
      -- fresh one below instead of returning 'pending' forever (seen live 2026-11-14: a stale id
      -- from an earlier session blocked every poll of a new match, so no throw ever arrived).
      if exists (select 1 from net.http_request_queue q where q.id = v_row.pending_poll_request_id)
         or v_row.updated_at > now() - interval '20 seconds' then
        return jsonb_build_object('status', 'pending');
      end if;
      perform set_config('darts.autodarts_internal_write', 'on', true);
      update public.autodarts_boards set pending_poll_request_id = null, pending_poll_kind = null, updated_at = now() where id = v_row.id;
      v_row.pending_poll_request_id := null;
    end if;
  end if;

  if v_row.pending_poll_request_id is not null then
    perform set_config('darts.autodarts_internal_write', 'on', true);

    if v_row.pending_poll_kind = 'refresh' then
      update public.autodarts_boards set pending_poll_request_id = null, pending_poll_kind = null, updated_at = now() where id = v_row.id;
      if v_status <> 200 then
        -- return, not raise: a raise would roll back the line above and re-read the same failed
        -- response on every later poll, forever.
        return jsonb_build_object('status', 'error', 'message', 'Autodarts: Token-Aktualisierung fehlgeschlagen, Status ' || v_status);
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
        return jsonb_build_object('status', 'error', 'message', 'Autodarts: Spielstand-Abfrage fehlgeschlagen, Status ' || v_status);
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
