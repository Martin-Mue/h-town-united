-- Autodarts now creates these games as "Local" matches: GET /gs/v0/matches/{id} only returns the match
-- info (players, settings, scores) WITHOUT turns -- the live state with turns/throws is at
-- GET /gs/v0/matches/{id}/state (Autodarts' own client: Match.getState() -> axios.get('/state')).
-- Seen live 2026-11-14: lobby + board assignment worked, Autodarts scored, Dartspot never saw a turn.
create or replace function public.autodarts_session_poll(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '10000'
as $function$
declare
  s public.autodarts_sessions;
  v_status int;
  v_response jsonb;
  v_token text;
  v_request bigint;
begin
  select * into s from public.autodarts_sessions where id = p_session_id and created_by = auth.uid();
  if s.id is null or s.lobby_id is null then
    return jsonb_build_object('status', 'error', 'message', 'Autodarts-Sitzung nicht gefunden');
  end if;
  if s.status = 'finished' then
    return jsonb_build_object('status', 'error', 'message', 'Autodarts-Spiel ist beendet');
  end if;

  if s.pending_poll_request_id is not null then
    select r.status_code, public._ad_json(r.content)
      into v_status, v_response from net._http_response r where r.id = s.pending_poll_request_id;
    if v_status is null then
      if not public._ad_request_lost(s.pending_poll_request_id, s.pending_poll_at) then
        return jsonb_build_object('status', 'pending');
      end if;
      -- lost: fall through and fire a fresh one
    else
      update public.autodarts_sessions set pending_poll_request_id = null, pending_poll_kind = null where id = s.id;
      if s.pending_poll_kind = 'refresh' then
        if v_status <> 200 then
          return jsonb_build_object('status', 'error', 'message', 'Autodarts-Anmeldung abgelaufen, Status ' || v_status);
        end if;
        perform public._ad_store_tokens(s.host_kind, s.host_ref, v_response);
        v_response := null;  -- never hand the token answer to the client
      elsif v_status <> 200 then
        v_response := jsonb_build_object('status', 'error', 'message', 'Autodarts: Spielstand-Abfrage fehlgeschlagen, Status ' || v_status);
      end if;
    end if;
  end if;

  v_token := public._ad_cached_token(s.host_kind, s.host_ref);
  if v_token is not null then
    v_request := net.http_get(url := 'https://api.autodarts.com/gs/v0/matches/' || s.lobby_id || '/state',
      headers := public._ad_headers(v_token), timeout_milliseconds := 5000);
    update public.autodarts_sessions set pending_poll_request_id = v_request, pending_poll_kind = 'match_get', pending_poll_at = now(), updated_at = now() where id = s.id;
  else
    v_request := public._ad_enqueue_refresh(s.host_kind, s.host_ref);
    update public.autodarts_sessions set pending_poll_request_id = v_request, pending_poll_kind = 'refresh', pending_poll_at = now(), updated_at = now() where id = s.id;
  end if;

  if s.pending_poll_kind = 'match_get' and v_status is not null then
    return v_response;
  end if;
  return coalesce(v_response, jsonb_build_object('status', 'pending'));
end;
$function$;
