-- Second CORS discovery (2026-09-15, proactive test before the user hit it live): api.autodarts.com
-- restricts ALL its endpoints to Origin/Referer https://play.autodarts.com -- not just
-- /auth/v1/login. A direct browser fetch() from Dartspot's own origin to /gs/v0/lobbies or
-- /gs/v0/matches/{id} fails with the exact same "TypeError: Failed to fetch" signature the login
-- endpoint had. This means the original architecture (client holds a short-lived access token and
-- calls Autodarts directly for match data) cannot work at all -- every Autodarts call, not just the
-- sensitive login/refresh ones, has to be proxied through Postgres+pg_net like
-- autodarts_connect_board/autodarts_refresh_board already are.
--
-- Net effect, and it's a genuine improvement, not just a workaround: the Autodarts access token
-- now never has to reach the client AT ALL, for anything. AutodartsLiveScore.tsx's ensureAccessToken
-- concept goes away entirely -- see the matching autodartsClient.ts rewrite.

-- Internal helper (deliberately no grant to authenticated/anon/public -- callable only from other
-- SECURITY DEFINER functions in this file, which run as this function's owner): given a board's
-- row, returns a fresh Autodarts access token, refreshing+re-encrypting the stored refresh token as
-- needed. Extracted out of autodarts_refresh_board's own logic so autodarts_start_match/
-- autodarts_poll_match/autodarts_finish_match don't each duplicate the same refresh-token exchange.
create or replace function public._autodarts_get_access_token(p_board_id uuid, p_club_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '25000'
as $function$
declare
  v_passphrase text;
  v_row record;
  v_stored_refresh_token text;
  v_refresh_response jsonb;
  v_refresh_status int;
  v_access_token text;
  v_new_refresh_token text;
  v_request_id bigint;
  v_poll_attempt int;
begin
  perform set_config('darts.autodarts_internal_write', 'on', true);

  select * into v_row from public.autodarts_boards where id = p_board_id and club_id = p_club_id;
  if v_row.id is null then
    raise exception 'Board nicht gefunden';
  end if;
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
    body := jsonb_build_object('refreshToken', v_stored_refresh_token, 'client_id', 'autodarts-play'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
    timeout_milliseconds := 20000
  );
  for v_poll_attempt in 1..70 loop
    select status_code, content::jsonb into v_refresh_status, v_refresh_response from net._http_response where id = v_request_id;
    exit when v_refresh_status is not null;
    perform pg_sleep(0.3);
  end loop;

  if v_refresh_status is null or v_refresh_status <> 200 then
    update public.autodarts_boards set status = 'error',
      last_error = coalesce(v_refresh_response->'error'->>'message', 'Token-Aktualisierung fehlgeschlagen, Status ' || coalesce(v_refresh_status::text, 'timeout')),
      updated_at = now()
    where id = v_row.id;
    raise exception 'Autodarts-Token-Aktualisierung fehlgeschlagen: %', coalesce(v_refresh_response->'error'->>'message', 'Status ' || coalesce(v_refresh_status::text, 'timeout'));
  end if;

  v_access_token := coalesce(v_refresh_response->>'accessToken', v_refresh_response->>'access_token');
  v_new_refresh_token := coalesce(v_refresh_response->>'refreshToken', v_refresh_response->>'refresh_token', v_stored_refresh_token);

  update public.autodarts_boards
  set refresh_token_ciphertext = encode(extensions.pgp_sym_encrypt(v_new_refresh_token, v_passphrase), 'base64'),
      token_updated_at = now(), status = 'connected', last_error = null, updated_at = now()
  where id = v_row.id;

  return v_access_token;
end;
$function$;

revoke all on function public._autodarts_get_access_token(uuid, uuid) from public, anon, authenticated;

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
set statement_timeout to '25000'
as $function$
declare
  v_club_id uuid;
  v_board_id uuid;
  v_access_token text;
  v_lobby_response jsonb;
  v_lobby_status int;
  v_lobby_id text;
  v_request_id bigint;
  v_poll_attempt int;
  v_start_status int;
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

  -- Same lobby-creation body as autodarts_connect_board's own comment sourced live -- bullOffMode
  -- "Off" is deliberate: Dartspot's own bull-off/starter-swap feature already decided who starts.
  v_request_id := net.http_post(
    url := 'https://api.autodarts.com/gs/v0/lobbies',
    body := jsonb_build_object(
      'variant', 'X01',
      'isPrivate', true,
      'bullOffMode', 'Off',
      'settings', jsonb_build_object(
        'baseScore', p_base_score,
        'inMode', 'Straight',
        'outMode', case when p_double_out then 'Double' else 'Straight' end,
        'maxRounds', 50,
        'bullMode', '25/50'
      ),
      'legs', p_legs
    ),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
    timeout_milliseconds := 15000
  );
  for v_poll_attempt in 1..50 loop
    select status_code, content::jsonb into v_lobby_status, v_lobby_response from net._http_response where id = v_request_id;
    exit when v_lobby_status is not null;
    perform pg_sleep(0.3);
  end loop;

  if v_lobby_status is null then
    raise exception 'Autodarts: Lobby-Erstellung -- keine Antwort (Timeout)';
  end if;
  if v_lobby_status not in (200, 201) then
    raise exception 'Autodarts: Lobby-Erstellung fehlgeschlagen: %', coalesce(v_lobby_response->'error'->>'message', 'Status ' || v_lobby_status);
  end if;

  v_lobby_id := v_lobby_response->>'id';
  if v_lobby_id is null then
    raise exception 'Autodarts: Lobby-Antwort ohne id -- Felder: %', (select string_agg(k, ', ') from jsonb_object_keys(v_lobby_response) as k);
  end if;

  -- Confirmed live: the lobby's own id is reused as the match id once started -- no separate
  -- matchId is returned by the start call itself (see autodartsClient.ts's own history).
  v_request_id := net.http_post(
    url := 'https://api.autodarts.com/gs/v0/lobbies/' || v_lobby_id || '/start',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/'),
    timeout_milliseconds := 15000
  );
  for v_poll_attempt in 1..50 loop
    select status_code into v_start_status from net._http_response where id = v_request_id;
    exit when v_start_status is not null;
    perform pg_sleep(0.3);
  end loop;

  if v_start_status is null then
    raise exception 'Autodarts: Lobby-Start -- keine Antwort (Timeout)';
  end if;
  if v_start_status not in (200, 201, 204) then
    raise exception 'Autodarts: Lobby-Start fehlgeschlagen, Status %', v_start_status;
  end if;

  return jsonb_build_object('matchId', v_lobby_id);
end;
$function$;

revoke all on function public.autodarts_start_match(integer, integer, boolean, integer) from public, anon;
grant execute on function public.autodarts_start_match(integer, integer, boolean, integer) to authenticated;

create or replace function public.autodarts_poll_match(p_board_number integer, p_match_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '25000'
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

  -- Confirmed live: GET /gs/v0/matches/{id} (bare, no "/state" suffix) returns the full match
  -- object (turns[]/gameScores/player/gameFinished/finished -- see autodartsClient.ts's
  -- parseAutodartsState for the exact fields this is parsed into client-side).
  v_request_id := net.http_get(
    url := 'https://api.autodarts.com/gs/v0/matches/' || p_match_id,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/')
  );
  for v_poll_attempt in 1..50 loop
    select status_code, content::jsonb into v_status, v_response from net._http_response where id = v_request_id;
    exit when v_status is not null;
    perform pg_sleep(0.3);
  end loop;

  if v_status is null then
    raise exception 'Autodarts: Spielstand-Abfrage -- keine Antwort (Timeout)';
  end if;
  if v_status <> 200 then
    raise exception 'Autodarts: Spielstand-Abfrage fehlgeschlagen: %', coalesce(v_response->'error'->>'message', 'Status ' || v_status);
  end if;

  return v_response;
end;
$function$;

revoke all on function public.autodarts_poll_match(integer, text) from public, anon;
grant execute on function public.autodarts_poll_match(integer, text) to authenticated;

-- Best-effort teardown -- closing the remote lobby is a courtesy, never something a finished/
-- abandoned local game should wait on or fail over (matches finishMatch's original doc comment).
-- Never raises: any failure anywhere in here is swallowed, not surfaced to the caller.
create or replace function public.autodarts_finish_match(p_board_number integer, p_match_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '25000'
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
    perform net.http_post(
      url := 'https://api.autodarts.com/gs/v0/matches/' || p_match_id || '/finish',
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_access_token, 'Origin', 'https://play.autodarts.com', 'Referer', 'https://play.autodarts.com/')
    );
  exception when others then
    null;
  end;
end;
$function$;

revoke all on function public.autodarts_finish_match(integer, text) from public, anon;
grant execute on function public.autodarts_finish_match(integer, text) to authenticated;
