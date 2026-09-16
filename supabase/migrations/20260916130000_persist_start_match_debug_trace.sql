-- User's own good idea after the lobby-creation step timed out live: stop making every failed
-- test round-trip through another blind guess. The reason net._http_response alone was never
-- enough to diagnose the timeout: autodarts_start_match used to RAISE EXCEPTION on a lobby-
-- creation failure, and Postgres rolls back the ENTIRE transaction of an uncaught exception --
-- any diagnostic row this function might have written earlier in the same call would have been
-- undone right along with it, leaving nothing to inspect afterward except the request_ids that
-- happened to survive in pg_net's own (separately-committed) response table, if they got that
-- far at all.
--
-- Fix: autodarts_start_match now never raises for a lobby/device/start-step failure -- it always
-- returns normally (status:'connected' or status:'error' in the payload itself) and persists a
-- full step-by-step trace (request ids, status codes, elapsed ms per step) into
-- autodarts_boards.last_match_debug on EVERY call, success or failure alike, specifically because
-- a normal RETURN commits the transaction, so this write survives regardless of outcome. Recording
-- each net.http_* call's request_id also means a genuinely delayed (not failed) worker response
-- can still be found afterward with a plain SELECT against net._http_response, decoupled from
-- however long THIS function itself was willing to wait.
alter table public.autodarts_boards
  add column if not exists last_match_debug jsonb;

-- Live gerade beobachtet: DIESER Refresh-Aufruf war der Fehlschlag ("Token-Aktualisierung
-- fehlgeschlagen: Status timeout"), nicht die Lobby-Erstellung -- bestaetigt, dass es sich um ein
-- generelles, wechselndes pg_net/Worker-Timing-Problem handelt, nicht um einen einzelnen
-- Endpunkt. Gleiche Behandlung wie die Lobby-Erstellung: mehr Wiederholungen/Geduld.
create or replace function public._autodarts_get_access_token(p_board_id uuid, p_club_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60000'
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

  -- retry_count=1 (NICHT mehrfach wiederholen) ist hier bewusst, anders als bei der Lobby-
  -- Erstellung: Refresh-Tokens rotieren typischerweise bei jeder Benutzung (einmal gueltig). Live
  -- beobachtet: mehrere Refresh-Versuche in Folge hingen alle bei ~54s (3 Retries a ~18s) fest,
  -- obwohl ein frischer, unabhaengiger Test-Aufruf (falscher Token) sofort eine saubere Antwort
  -- bekam -- das deutet darauf hin, dass ein FRUEHERER Versuch serverseitig eigentlich durchging
  -- (den gespeicherten Token verbrauchte/rotierte), unsere Wartezeit aber schon abgelaufen war,
  -- sodass jeder folgende Versuch (und jeder Retry) mit dem jetzt bereits verbrauchten alten Token
  -- arbeitete -- ein sich selbst verstaerkender Fehlzustand. Ein Retry auf denselben (potenziell
  -- schon konsumierten) Token drauf ist hier keine sichere Wiederholung wie bei der (idempotenten)
  -- Lobby-Erstellung, sondern kann das Problem aktiv verschlimmern. Stattdessen: nur EIN Versuch,
  -- dafuer mit voller Geduld (waehrend 100 mal 300ms warten).
  select h.status_code, h.content into v_refresh_status, v_refresh_response
  from public._autodarts_http_post_polled(
    'https://api.autodarts.com/auth/v1/refresh',
    jsonb_build_object('refreshToken', v_stored_refresh_token, 'client_id', 'autodarts-play'),
    v_browser_headers,
    25000, 100, 1
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
set statement_timeout to '90000'
as $function$
declare
  v_club_id uuid;
  v_board_id uuid;
  v_stored_board_id text;
  v_access_token text;
  v_lobby_response jsonb;
  v_lobby_status int;
  v_lobby_id text;
  v_start_status int;
  v_start_response jsonb;
  v_auth_headers jsonb;
  v_boards_status int;
  v_boards_response jsonb;
  v_autoscoring_device_id text;
  v_host_user_id text;
  v_assign_status int;
  v_assign_response jsonb;
  v_request_id bigint;
  v_poll_attempt int;
  v_debug jsonb := '{}'::jsonb;
  v_t0 timestamptz;
  v_result jsonb;
begin
  select ur.club_id into v_club_id from public.user_roles ur where ur.user_id = auth.uid() limit 1;
  if v_club_id is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;

  select id, autodarts_board_id into v_board_id, v_stored_board_id from public.autodarts_boards where club_id = v_club_id and board_number = p_board_number;
  if v_board_id is null then
    raise exception 'Board nicht verbunden';
  end if;

  begin
    v_t0 := clock_timestamp();
    v_access_token := public._autodarts_get_access_token(v_board_id, v_club_id);
    v_debug := v_debug || jsonb_build_object('get_access_token', jsonb_build_object('ok', true, 'elapsed_ms', extract(epoch from (clock_timestamp() - v_t0)) * 1000));
  exception when others then
    v_debug := v_debug || jsonb_build_object('get_access_token', jsonb_build_object('ok', false, 'elapsed_ms', extract(epoch from (clock_timestamp() - v_t0)) * 1000, 'error', sqlerrm));
    update public.autodarts_boards set last_match_debug = v_debug, updated_at = now() where id = v_board_id;
    return jsonb_build_object('status', 'error', 'step', 'get_access_token', 'message', sqlerrm, 'debug', v_debug);
  end;
  v_auth_headers := jsonb_build_object(
    'Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_access_token,
    'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/',
    'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'Accept', 'application/json, text/plain, */*', 'Accept-Language', 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
  );

  -- === Schritt 1: Lobby erzeugen ===
  v_t0 := clock_timestamp();
  select h.status_code, h.content into v_lobby_status, v_lobby_response
  from public._autodarts_http_post_polled(
    'https://api.autodarts.com/gs/v0/lobbies',
    jsonb_build_object(
      'variant', 'X01', 'isPrivate', true, 'bullOffMode', 'Off',
      'settings', jsonb_build_object(
        'baseScore', p_base_score, 'inMode', 'Straight',
        'outMode', case when p_double_out then 'Double' else 'Straight' end,
        'maxRounds', 50, 'bullMode', '25/50'
      ),
      'legs', p_legs
    ),
    v_auth_headers,
    20000, 60, 3
  ) h;
  v_debug := v_debug || jsonb_build_object('lobby_create', jsonb_build_object(
    'status', v_lobby_status, 'elapsed_ms', extract(epoch from (clock_timestamp() - v_t0)) * 1000,
    'response_preview', left(v_lobby_response::text, 500)
  ));

  if v_lobby_status is null then
    v_result := jsonb_build_object('status', 'error', 'step', 'lobby_create', 'message', 'Lobby-Erstellung: keine Antwort (Timeout, auch nach 3 Versuchen)', 'debug', v_debug);
    update public.autodarts_boards set last_match_debug = v_debug, updated_at = now() where id = v_board_id;
    return v_result;
  end if;
  if v_lobby_status not in (200, 201) then
    v_result := jsonb_build_object('status', 'error', 'step', 'lobby_create', 'message', coalesce(v_lobby_response->'error'->>'message', v_lobby_response->>'message', 'Status ' || v_lobby_status), 'debug', v_debug);
    update public.autodarts_boards set last_match_debug = v_debug, updated_at = now() where id = v_board_id;
    return v_result;
  end if;

  v_lobby_id := v_lobby_response->>'id';
  if v_lobby_id is null then
    v_result := jsonb_build_object('status', 'error', 'step', 'lobby_create', 'message', 'Lobby-Antwort ohne id', 'debug', v_debug);
    update public.autodarts_boards set last_match_debug = v_debug, updated_at = now() where id = v_board_id;
    return v_result;
  end if;
  v_debug := v_debug || jsonb_build_object('lobby_id', v_lobby_id);

  -- === Schritt 2: Erkennungsgeraet zuweisen (best-effort, siehe vorige Migration) ===
  begin
    v_t0 := clock_timestamp();
    v_request_id := net.http_get(url := 'https://api.autodarts.com/bs/v0/boards', headers := v_auth_headers, timeout_milliseconds := 8000);
    for v_poll_attempt in 1..20 loop
      select status_code, content::jsonb into v_boards_status, v_boards_response from net._http_response where id = v_request_id;
      exit when v_boards_status is not null;
      perform pg_sleep(0.3);
    end loop;
    v_debug := v_debug || jsonb_build_object('boards_get', jsonb_build_object(
      'request_id', v_request_id, 'status', v_boards_status, 'elapsed_ms', extract(epoch from (clock_timestamp() - v_t0)) * 1000,
      'device_count', case when jsonb_typeof(v_boards_response) = 'array' then jsonb_array_length(v_boards_response) else null end
    ));

    if v_boards_status = 200 and jsonb_typeof(v_boards_response) = 'array' then
      if v_stored_board_id is not null then
        select b->>'id' into v_autoscoring_device_id from jsonb_array_elements(v_boards_response) b
        where b->>'id' = v_stored_board_id and coalesce((b->>'connected')::boolean, false) = true limit 1;
      end if;
      if v_autoscoring_device_id is null then
        select b->>'id' into v_autoscoring_device_id from jsonb_array_elements(v_boards_response) b
        where b->>'deviceType' = 'lens' and coalesce((b->>'connected')::boolean, false) = true limit 1;
      end if;
      if v_autoscoring_device_id is null then
        select b->>'id' into v_autoscoring_device_id from jsonb_array_elements(v_boards_response) b
        where coalesce((b->>'connected')::boolean, false) = true limit 1;
      end if;
    end if;
    if v_autoscoring_device_id is null then
      v_autoscoring_device_id := v_stored_board_id;
    end if;
    v_debug := v_debug || jsonb_build_object('chosen_device_id', v_autoscoring_device_id);

    if v_autoscoring_device_id is not null then
      v_host_user_id := public._jwt_claim(v_access_token, 'sub');
      v_debug := v_debug || jsonb_build_object('host_user_id', v_host_user_id);
      if v_host_user_id is not null then
        v_t0 := clock_timestamp();
        v_request_id := net.http_delete(url := 'https://api.autodarts.com/gs/v0/lobbies/' || v_lobby_id || '/players/by-userid/' || v_host_user_id, headers := v_auth_headers, timeout_milliseconds := 8000);
        for v_poll_attempt in 1..20 loop
          exit when exists (select 1 from net._http_response where id = v_request_id);
          perform pg_sleep(0.3);
        end loop;
        v_debug := v_debug || jsonb_build_object('remove_host_player', jsonb_build_object('request_id', v_request_id, 'elapsed_ms', extract(epoch from (clock_timestamp() - v_t0)) * 1000));

        v_t0 := clock_timestamp();
        select h.status_code, h.content into v_assign_status, v_assign_response
        from public._autodarts_http_post_polled(
          'https://api.autodarts.com/gs/v0/lobbies/' || v_lobby_id || '/players',
          jsonb_build_object('name', coalesce(public._jwt_claim(v_access_token, 'preferred_username'), 'Dartspot'), 'hostId', v_host_user_id, 'boardId', v_autoscoring_device_id),
          v_auth_headers, 8000, 20, 1
        ) h;
        v_debug := v_debug || jsonb_build_object('add_player_with_board', jsonb_build_object(
          'status', v_assign_status, 'elapsed_ms', extract(epoch from (clock_timestamp() - v_t0)) * 1000,
          'response_preview', left(v_assign_response::text, 500)
        ));
      end if;
    end if;
  exception when others then
    v_debug := v_debug || jsonb_build_object('autoscoring_assign_exception', sqlerrm);
  end;

  -- === Schritt 3: Lobby starten ===
  v_t0 := clock_timestamp();
  select h.status_code, h.content into v_start_status, v_start_response
  from public._autodarts_http_post_polled(
    'https://api.autodarts.com/gs/v0/lobbies/' || v_lobby_id || '/start',
    '{}'::jsonb, v_auth_headers, 15000, 50, 2
  ) h;
  v_debug := v_debug || jsonb_build_object('lobby_start', jsonb_build_object(
    'status', v_start_status, 'elapsed_ms', extract(epoch from (clock_timestamp() - v_t0)) * 1000,
    'response_preview', left(v_start_response::text, 500)
  ));

  if v_start_status is null or v_start_status not in (200, 201, 204) then
    v_result := jsonb_build_object('status', 'error', 'step', 'lobby_start', 'message',
      case when v_start_status is null then 'Lobby-Start: keine Antwort (Timeout, auch nach Wiederholung)'
           else 'Lobby-Start fehlgeschlagen, Status ' || v_start_status end,
      'debug', v_debug);
    update public.autodarts_boards set last_match_debug = v_debug, updated_at = now() where id = v_board_id;
    return v_result;
  end if;

  v_result := jsonb_build_object('matchId', v_lobby_id, 'status', 'connected', 'autoscoringDeviceId', v_autoscoring_device_id, 'debug', v_debug);
  update public.autodarts_boards set last_match_debug = v_debug, updated_at = now() where id = v_board_id;
  return v_result;
end;
$function$;
