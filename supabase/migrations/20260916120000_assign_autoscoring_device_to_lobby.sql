-- Root cause of "Autodarts zeigt gar nichts an, obwohl ein Spiel läuft" (live gemeldet, KEIN
-- Reload noetig -- also unabhaengig vom crash-recovery-Fix von gestern): autodarts_start_match hat
-- bisher nur eine Lobby erzeugt und sofort gestartet -- nie ein Erkennungsgeraet (Board oder
-- "LENS") zugewiesen. Aus dem oeffentlichen, unminifizierten Autodarts-Web-Client selbst
-- rekonstruiert (2026-09-16, AutoscoringSelector-*.js + lobby._lobbyId-*.js + clients-*.js --
-- kein DevTools-Mitschnitt eines echten Spiels noetig, die Web-App liefert ihre eigene
-- Aufruf-Logik im Klartext mit, siehe deren i18n-Keys "lobby.autoscoring.selectDevice" etc.):
--
--   1. GET https://api.autodarts.com/bs/v0/boards
--      -> Liste der Geraete des Accounts, jedes mit u.a. id/deviceType/connected.
--         deviceType ist eines von "manual" | "lens" | "vantage" | "link".
--   2. PUT https://api.autodarts.com/gs/v0/lobbies/{lobbyId}/players/by-userid/{userId}/board
--      Body: { "boardId": "<id aus Schritt 1>" }
--      -- exakt der Aufruf hinter dem "Autoscoring"-Geraeteauswahl-Dialog in der echten Web-App
--      ("you pick LENS the same way you'd pick a board", offizielle Autodarts-Doku).
--
-- Ohne Schritt 2 existiert die Lobby zwar und laesst sich starten, aber KEIN Geraet (weder ein
-- echtes Board noch das Lens-Handy) weiss, dass es fuer genau dieses Match werfen soll -- die
-- Lobby bleibt komplett verwaist. Erklaert die live gemeldeten Symptome vollstaendig: beide in
-- Dartspot hinterlegten Boards zeigten in Autodarts selbst "has never been connected", und ein
-- druckfrisch (ganz ohne Reload) gestartetes Spiel zeigte trotzdem nichts.
--
-- Drei Teile bleiben Bestes-Wissen-Rekonstruktion aus dem Web-Client-Code, NICHT live gegen ein
-- echtes Match bestaetigt:
--  (a) pg_net kann kein echtes PUT senden (nur get/post/delete, siehe pg_net-Dokumentation/-Issues)
--      -- Schritt 2 geht deshalb als POST mit X-HTTP-Method-Override:PUT raus, einer verbreiteten,
--      aber fuer Autodarts' Server NICHT bestaetigten Konvention. Schlaegt das fehl, bleibt es
--      wirkungslos (siehe Fehlerbehandlung unten), aendert aber nichts an den sonst schon
--      funktionierenden Schritten.
--  (b) Welches Geraet auswaehlen, wenn mehrere vorhanden sind -- bevorzugt ein verbundenes
--      Lens-Geraet, sonst irgendein verbundenes Geraet, sonst als letzter Ruckfall die frueher
--      vom Nutzer hinterlegte autodarts_board_id (fuer ein klassisches Hardware-Board -- fuer
--      Lens nie zutreffend, da dessen Geraete-ID pro Erkennungssession neu vergeben wird).
--  (c) Die userId fuer den Zuweisungs-Aufruf -- aus dem "sub"-Claim des Access-Tokens dekodiert
--      (Standard-JWT-Konvention), da die echte Web-App sie stattdessen aus ihrem eigenen
--      Session-Objekt liest, auf das wir keinen Zugriff haben.
--
-- Ein Fehlschlag in JEDEM dieser drei Teile darf das Spiel trotzdem starten lassen (der Nutzer
-- kann notfalls manuell in Autodarts zuweisen) statt das ganze Match platzen zu lassen -- daher
-- als eigener, fehlerisolierter Unterblock statt die Lobby-Erstellung/-Start davon abhaengig zu
-- machen.
create or replace function public._jwt_claim(p_token text, p_claim text)
returns text
language plpgsql
immutable
as $function$
declare
  v_payload_b64 text;
  v_payload_json jsonb;
begin
  v_payload_b64 := split_part(p_token, '.', 2);
  if v_payload_b64 = '' then
    return null;
  end if;
  -- base64url -> base64: +/- und /_ vertauscht, Padding im JWT-Standard weggelassen -- vor
  -- Postgres' eigenem Base64-Decoder (versteht nur Standard-Base64) wiederherstellen.
  v_payload_b64 := replace(replace(v_payload_b64, '-', '+'), '_', '/');
  v_payload_b64 := v_payload_b64 || repeat('=', (4 - length(v_payload_b64) % 4) % 4);
  v_payload_json := convert_from(decode(v_payload_b64, 'base64'), 'utf8')::jsonb;
  return v_payload_json->>p_claim;
exception when others then
  return null;
end;
$function$;

revoke all on function public._jwt_claim(text, text) from public, anon, authenticated;

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
begin
  select ur.club_id into v_club_id from public.user_roles ur where ur.user_id = auth.uid() limit 1;
  if v_club_id is null then
    raise exception 'Keine Vereinsmitgliedschaft gefunden';
  end if;

  select id, autodarts_board_id into v_board_id, v_stored_board_id from public.autodarts_boards where club_id = v_club_id and board_number = p_board_number;
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

  -- NEU: Erkennungsgeraet zuweisen -- siehe diese Migration's eigener Kommentar oben.
  begin
    v_request_id := net.http_get(url := 'https://api.autodarts.com/bs/v0/boards', headers := v_auth_headers, timeout_milliseconds := 8000);
    for v_poll_attempt in 1..20 loop
      select status_code, content::jsonb into v_boards_status, v_boards_response from net._http_response where id = v_request_id;
      exit when v_boards_status is not null;
      perform pg_sleep(0.3);
    end loop;

    if v_boards_status = 200 and jsonb_typeof(v_boards_response) = 'array' then
      select b->>'id' into v_autoscoring_device_id
      from jsonb_array_elements(v_boards_response) b
      where b->>'deviceType' = 'lens' and coalesce((b->>'connected')::boolean, false) = true
      limit 1;
      if v_autoscoring_device_id is null then
        select b->>'id' into v_autoscoring_device_id
        from jsonb_array_elements(v_boards_response) b
        where coalesce((b->>'connected')::boolean, false) = true
        limit 1;
      end if;
    end if;
    if v_autoscoring_device_id is null then
      v_autoscoring_device_id := v_stored_board_id;
    end if;

    if v_autoscoring_device_id is not null then
      v_host_user_id := public._jwt_claim(v_access_token, 'sub');
      if v_host_user_id is not null then
        select h.status_code, h.content into v_assign_status, v_assign_response
        from public._autodarts_http_post_polled(
          'https://api.autodarts.com/gs/v0/lobbies/' || v_lobby_id || '/players/by-userid/' || v_host_user_id || '/board',
          jsonb_build_object('boardId', v_autoscoring_device_id),
          v_auth_headers || jsonb_build_object('X-HTTP-Method-Override', 'PUT'),
          8000, 20, 1
        ) h;
      end if;
    end if;
  exception when others then
    null; -- best-effort -- siehe Kommentar oben, Spiel soll trotzdem starten
  end;

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

  return jsonb_build_object(
    'matchId', v_lobby_id,
    'autoscoringDeviceId', v_autoscoring_device_id,
    'autoscoringAssignStatus', v_assign_status,
    'autoscoringHostUserId', v_host_user_id
  );
end;
$function$;
