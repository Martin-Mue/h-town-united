-- Eigener Fehler in der letzten Migration (20260916140000): die dortige Neufassung von
-- autodarts_connect_board war versehentlich von der AELTEREN, SYNCHRONEN Fassung
-- (20260915230000_add_autodarts_http_retry_helper.sql) abgeleitet -- nicht von der spaeteren,
-- extra dafuer eingefuehrten ASYNCHRONEN Fassung (20260915240000_make_autodarts_connect_async.sql,
-- fire-and-forget + autodarts_check_connect_status-Polling, genau damit ein einzelner PostgREST-
-- RPC-Aufruf nie mehr 45s lang blockiert). Dadurch wurde dieser Architektur-Fix ungewollt wieder
-- rueckgaengig gemacht. Stellt die asynchrone Fassung 1:1 wieder her -- einzige inhaltliche
-- Aenderung gegenueber 20260915240000 ist dieselbe Feldnamen-Korrektur wie ueberall sonst:
-- `username` statt `email` im Login-Body (bestaetigt durch den echten, oeffentlichen Autodarts-
-- Web-Client-Code). autodarts_check_connect_status bleibt unveraendert (nie im Request-Body
-- involviert, daher von diesem Fehler nicht betroffen).
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
      body := jsonb_build_object('username', p_cloud_email, 'password', p_cloud_password, 'client_id', 'autodarts-play'),
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
