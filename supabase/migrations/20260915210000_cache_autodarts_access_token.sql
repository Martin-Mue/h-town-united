-- Proactive fix, before this became the next mystery bug: _autodarts_get_access_token exchanged
-- the stored refresh token for a brand new access token on EVERY call, with no caching -- during
-- an actual game, autodarts_poll_match calls it roughly every 1.75s, meaning a full Autodarts
-- refresh-grant round-trip on every single poll tick. Beyond the wasted latency (stacking on top of
-- the poll's own /gs/v0/matches/{id} call), this is exactly the kind of repeated-auth-traffic
-- pattern already suspected of triggering rate-limiting/slowdowns against api.autodarts.com during
-- this integration's own testing earlier today.
--
-- access_token is stored in plain text (not pgcrypto-encrypted like refresh_token_ciphertext) --
-- deliberately: it's short-lived (whatever Autodarts' own expiresIn says, typically well under an
-- hour) and never granted to authenticated/anon below, so the only thing that can ever read it is
-- the service-role-equivalent context these SECURITY DEFINER functions already run in. Encrypting
-- a value that's worthless within minutes anyway would add cost with no real benefit.
alter table public.autodarts_boards
  add column if not exists access_token text,
  add column if not exists access_token_expires_at timestamptz;

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
  v_expires_in int;
  v_request_id bigint;
  v_poll_attempt int;
begin
  perform set_config('darts.autodarts_internal_write', 'on', true);

  select * into v_row from public.autodarts_boards where id = p_board_id and club_id = p_club_id;
  if v_row.id is null then
    raise exception 'Board nicht gefunden';
  end if;

  -- Cache hit: skip the network call entirely. 60s safety margin before the token's real expiry
  -- so a poll tick never starts a call with a token that expires mid-flight.
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
