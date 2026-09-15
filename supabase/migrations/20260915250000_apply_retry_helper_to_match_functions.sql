-- autodarts_start_match/autodarts_poll_match/autodarts_finish_match (and the access-token refresh
-- they all share) still used the original, retry-less inline net.http_post/http_get + poll-once
-- pattern -- the same pattern that just proved unreliable enough on autodarts_connect_board to be
-- worth a shared retry helper (_autodarts_http_post_polled, see the two preceding migrations).
-- These three haven't failed live yet (no real match has been started against hardware so far), but
-- there's no reason to expect pg_net's worker-timing behavior to be any different for a /gs/v0/...
-- call than it was for /auth/v1/login -- so applying the same fix here now, before the first real
-- game, rather than waiting to rediscover the identical bug mid-match.
--
-- autodarts_poll_match gets a DELIBERATELY SHORT window and no retry, unlike connect_board: it's
-- already called by AutodartsLiveScore.tsx every ~1.75s during live play, so a failed tick is cheap
-- (the client's own next tick is the natural retry, and AutodartsLiveScore already falls back to
-- manual entry after N consecutive failures) -- letting ONE tick block for up to ~40s internally
-- would freeze the visible scoreboard far longer than just failing fast and letting the existing
-- polling cadence recover. autodarts_start_match (a one-time, user-initiated "start game" action)
-- keeps the helper's default retry-once behavior, same reasoning as autodarts_connect_board.
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
set statement_timeout to '45000'
as $function$
declare
  v_club_id uuid;
  v_board_id uuid;
  v_access_token text;
  v_lobby_response jsonb;
  v_lobby_status int;
  v_lobby_id text;
  v_start_status int;
  v_start_response jsonb;
  v_auth_headers jsonb;
begin
  select ur.club_id into v_club_id from public.user_roles ur where ur.user_id = auth.uid() limit 1;
  if v_club_id is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;

  select id into v_board_id from public.autodarts_boards where club_id = v_club_id and board_number = p_board_number;
  if v_board_id is null then
    raise exception 'Board nicht verbunden';
  end if;

  v_access_token := public._autodarts_get_access_token(v_board_id, v_club_id);
  v_auth_headers := jsonb_build_object(
    'Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_access_token,
    'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/',
    'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'Accept', 'application/json, text/plain, */*', 'Accept-Language', 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
  );

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
    15000, 50, 2
  ) h;

  if v_lobby_status is null then
    raise exception 'Autodarts: Lobby-Erstellung -- keine Antwort (Timeout, auch nach Wiederholung)';
  end if;
  if v_lobby_status not in (200, 201) then
    raise exception 'Autodarts: Lobby-Erstellung fehlgeschlagen: %', coalesce(v_lobby_response->'error'->>'message', v_lobby_response->>'message', 'Status ' || v_lobby_status);
  end if;

  v_lobby_id := v_lobby_response->>'id';
  if v_lobby_id is null then
    raise exception 'Autodarts: Lobby-Antwort ohne id -- Felder: %', (select string_agg(k, ', ') from jsonb_object_keys(v_lobby_response) as k);
  end if;

  select h.status_code, h.content into v_start_status, v_start_response
  from public._autodarts_http_post_polled(
    'https://api.autodarts.com/gs/v0/lobbies/' || v_lobby_id || '/start',
    '{}'::jsonb,
    v_auth_headers,
    15000, 50, 2
  ) h;

  if v_start_status is null then
    raise exception 'Autodarts: Lobby-Start -- keine Antwort (Timeout, auch nach Wiederholung)';
  end if;
  if v_start_status not in (200, 201, 204) then
    raise exception 'Autodarts: Lobby-Start fehlgeschlagen, Status %', v_start_status;
  end if;

  return jsonb_build_object('matchId', v_lobby_id);
end;
$function$;

create or replace function public.autodarts_poll_match(p_board_number integer, p_match_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '15000'
as $function$
declare
  v_club_id uuid;
  v_board_id uuid;
  v_access_token text;
  v_response jsonb;
  v_status int;
  v_request_id bigint;
  v_poll_attempt int;
begin
  select ur.club_id into v_club_id from public.user_roles ur where ur.user_id = auth.uid() limit 1;
  if v_club_id is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;

  select id into v_board_id from public.autodarts_boards where club_id = v_club_id and board_number = p_board_number;
  if v_board_id is null then
    raise exception 'Board nicht verbunden';
  end if;

  v_access_token := public._autodarts_get_access_token(v_board_id, v_club_id);

  -- Deliberately fails fast (short window, no retry) -- see this migration's own header comment on
  -- why a poll tick should never block for long: AutodartsLiveScore.tsx re-invokes this every
  -- ~1.75s regardless, so that cadence IS the retry.
  v_request_id := net.http_get(
    url := 'https://api.autodarts.com/gs/v0/matches/' || p_match_id,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/',
      'User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      'Accept', 'application/json, text/plain, */*', 'Accept-Language', 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
    ),
    timeout_milliseconds := 5000
  );
  for v_poll_attempt in 1..16 loop
    select status_code, content::jsonb into v_status, v_response from net._http_response where id = v_request_id;
    exit when v_status is not null;
    perform pg_sleep(0.3);
  end loop;

  if v_status is null then
    raise exception 'Autodarts: Spielstand-Abfrage -- keine Antwort (Timeout)';
  end if;
  if v_status <> 200 then
    raise exception 'Autodarts: Spielstand-Abfrage fehlgeschlagen: %', coalesce(v_response->'error'->>'message', v_response->>'message', 'Status ' || v_status);
  end if;

  return v_response;
end;
$function$;

create or replace function public.autodarts_finish_match(p_board_number integer, p_match_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '45000'
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

  begin
    v_access_token := public._autodarts_get_access_token(v_board_id, v_club_id);
    perform public._autodarts_http_post_polled(
      'https://api.autodarts.com/gs/v0/matches/' || p_match_id || '/finish',
      '{}'::jsonb,
      jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
      10000, 20, 1
    );
  exception when others then
    null;
  end;
end;
$function$;
