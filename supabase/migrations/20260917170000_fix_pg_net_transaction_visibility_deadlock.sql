-- THE actual root cause of every "Status timeout" seen all day, across every different endpoint
-- (login, refresh, lobby creation) -- confirmed via pg_net's own documented behavior: an HTTP
-- request enqueued by net.http_post() is NOT picked up by pg_net's background worker until the
-- CALLING TRANSACTION COMMITS. _autodarts_http_post_polled (and autodarts_poll_match's own inline
-- loop) enqueue the request AND poll for its result WITHIN THE SAME still-open transaction/function
-- call -- a structural impossibility, not a flaky timing issue: the worker can never see the queued
-- row until the transaction ends, but the transaction can't end until the poll loop gives up
-- waiting for a response that can only arrive after it ends. Every "wait longer/retry more" fix
-- applied earlier today could never have worked, because no amount of waiting inside one unbroken
-- transaction changes this.
--
-- Proof: an isolated net.http_post() called as its OWN top-level statement (auto-committing
-- immediately), checked via a SEPARATE later statement, resolves in well under a second, every
-- time. The exact same call, wrapped in a function that also polls internally, times out at
-- exactly poll_attempts*sleep_interval, every time -- because the "success" path was never actually
-- reachable.
--
-- Fix: every call that needs to wait on pg_net now does so the way autodarts_connect_board /
-- autodarts_check_connect_status already correctly do -- enqueue in one RPC call that returns
-- immediately, resolve on a LATER, separate RPC call (the client's own poll loop, which already
-- exists everywhere this matters). autodarts_start_match becomes a small client-polled state
-- machine (refresh -> lobby_create -> boards_get -> remove_host -> add_player -> lobby_start).
-- autodarts_poll_match becomes "check the previous tick's request, fire the next one" instead of
-- enqueue+wait every tick. autodarts_finish_match needs no result at all (best-effort teardown,
-- already swallowed client-side) so it just fires and returns.

alter table public.autodarts_boards
  add column if not exists pending_match_setup jsonb,
  add column if not exists pending_poll_request_id bigint,
  add column if not exists pending_poll_kind text;

-- Pure, synchronous, no pg_net involved -- safe to call from anywhere without the transaction-
-- visibility trap above, since it never waits on anything.
create or replace function public._autodarts_cached_token(p_board_id uuid, p_club_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row record;
begin
  select access_token, access_token_expires_at into v_row
    from public.autodarts_boards where id = p_board_id and club_id = p_club_id;
  if v_row.access_token is not null and v_row.access_token_expires_at is not null
     and v_row.access_token_expires_at > now() + interval '60 seconds' then
    return v_row.access_token;
  end if;
  return null;
end;
$function$;

revoke all on function public._autodarts_cached_token(uuid, uuid) from public, anon, authenticated;

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
      headers := jsonb_build_object(
        'Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_cached_token,
        'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'
      ),
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
      headers := jsonb_build_object('Content-Type', 'application/json'),
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

revoke all on function public.autodarts_start_match(integer, integer, boolean, integer) from public, anon;
grant execute on function public.autodarts_start_match(integer, integer, boolean, integer) to authenticated;

-- The state-machine driver: one client poll tick = check the CURRENT step's request, and if it
-- resolved, either advance to the next step (fire the next request, stay "pending") or finish.
-- Never waits inside this call -- always returns immediately with whatever it currently knows.
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
      headers := jsonb_build_object(
        'Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_access_token,
        'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'
      ),
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
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
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
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
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
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
      timeout_milliseconds := 8000
    );
    update public.autodarts_boards set pending_match_setup = jsonb_build_object(
      'step', 'remove_host', 'request_id', v_request_id, 'access_token', v_access_token, 'lobby_id', v_lobby_id,
      'host_user_id', v_host_user_id, 'autoscoring_device_id', v_autoscoring_device_id
    ), updated_at = now() where id = v_row.id;
    return jsonb_build_object('status', 'pending');
  end if;

  -- remove_host's own outcome is ignored (best-effort -- the player may not have existed yet).
  if v_state->>'step' = 'remove_host' then
    v_access_token := v_state->>'access_token';
    v_lobby_id := v_state->>'lobby_id';
    v_request_id := net.http_post(
      url := 'https://api.autodarts.com/gs/v0/lobbies/' || v_lobby_id || '/players',
      body := jsonb_build_object('name', coalesce(public._jwt_claim(v_access_token, 'preferred_username'), 'Dartspot'), 'hostId', v_state->>'host_user_id', 'boardId', v_state->>'autoscoring_device_id'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
      timeout_milliseconds := 8000
    );
    update public.autodarts_boards set pending_match_setup = jsonb_build_object(
      'step', 'add_player', 'request_id', v_request_id, 'access_token', v_access_token, 'lobby_id', v_lobby_id,
      'autoscoring_device_id', v_state->>'autoscoring_device_id'
    ), updated_at = now() where id = v_row.id;
    return jsonb_build_object('status', 'pending');
  end if;

  -- add_player's own outcome is ALSO ignored (best-effort device assignment -- a failure here
  -- shouldn't block the match itself from starting, same reasoning as before).
  if v_state->>'step' = 'add_player' then
    v_access_token := v_state->>'access_token';
    v_lobby_id := v_state->>'lobby_id';
    v_request_id := net.http_post(
      url := 'https://api.autodarts.com/gs/v0/lobbies/' || v_lobby_id || '/start',
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
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

revoke all on function public.autodarts_check_start_match_status(integer) from public, anon;
grant execute on function public.autodarts_check_start_match_status(integer) to authenticated;

-- Same "check previous, fire next" shape, driven by AutodartsLiveScore.tsx's existing ~1.75s poll
-- cadence -- no client-visible contract change needed, this function just stops trying to
-- synchronously wait on pg_net within itself.
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
          headers := jsonb_build_object('Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
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
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
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
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 8000
    );
    update public.autodarts_boards set pending_poll_request_id = v_request_id, pending_poll_kind = 'refresh', updated_at = now() where id = v_row.id;
  end if;
  return jsonb_build_object('status', 'pending');
end;
$function$;

revoke all on function public.autodarts_poll_match(integer, text) from public, anon;
grant execute on function public.autodarts_poll_match(integer, text) to authenticated;

-- Best-effort teardown -- nobody waits on the result (already true client-side), so it doesn't
-- need to wait on pg_net either. Skips entirely if there's no valid cached token rather than
-- burning a whole refresh cycle just to say goodbye to a lobby that will expire on its own anyway.
create or replace function public.autodarts_finish_match(p_board_number integer, p_match_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid;
  v_board_id uuid;
  v_access_token text;
begin
  select ur.club_id into v_club_id from public.user_roles ur where ur.user_id = auth.uid() limit 1;
  if v_club_id is null then
    return;
  end if;
  select id into v_board_id from public.autodarts_boards where club_id = v_club_id and board_number = p_board_number;
  if v_board_id is null then
    return;
  end if;

  v_access_token := public._autodarts_cached_token(v_board_id, v_club_id);
  if v_access_token is null then
    return;
  end if;

  begin
    perform net.http_post(
      url := 'https://api.autodarts.com/gs/v0/matches/' || p_match_id || '/finish',
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
      timeout_milliseconds := 8000
    );
  exception when others then
    null;
  end;
end;
$function$;

revoke all on function public.autodarts_finish_match(integer, text) from public, anon;
grant execute on function public.autodarts_finish_match(integer, text) to authenticated;
