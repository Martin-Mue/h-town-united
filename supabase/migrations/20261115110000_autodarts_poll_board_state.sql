-- Autodarts: hold a finished visit until the darts are pulled (user wish 2026-11-15).
--
-- Seen live: Autodarts moves on to the next turn on its own ~3-4 s after the third dart (right after the
-- first dart of a bust), while the darts are still in the board -- so "new turn" is no takeout signal.
-- The board itself reports it: GET /bs/v0/boards -> state {status: Throw | Takeout | Takeout in progress,
-- numThrows}. autodarts_session_poll can now fetch that board state alongside the match state
-- (p_with_board, only while a visit waits for its takeout) and hands it back as "_board".

alter table public.autodarts_sessions
  add column if not exists pending_board_request_id bigint,
  add column if not exists pending_board_at timestamptz;

drop function if exists public.autodarts_session_poll(uuid);

create or replace function public.autodarts_session_poll(p_session_id uuid, p_with_board boolean default false)
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
  v_board_status int;
  v_board_response jsonb;
  v_board jsonb;
  v_token text;
  v_request bigint;
  v_result jsonb;
begin
  select * into s from public.autodarts_sessions where id = p_session_id and created_by = auth.uid();
  if s.id is null or s.lobby_id is null then
    return jsonb_build_object('status', 'error', 'message', 'Autodarts-Sitzung nicht gefunden');
  end if;
  if s.status = 'finished' then
    return jsonb_build_object('status', 'error', 'message', 'Autodarts-Spiel ist beendet');
  end if;

  -- Board state answer from the previous tick (if one was asked for).
  if s.pending_board_request_id is not null then
    select r.status_code, public._ad_json(r.content) into v_board_status, v_board_response
      from net._http_response r where r.id = s.pending_board_request_id;
    if v_board_status is not null or public._ad_request_lost(s.pending_board_request_id, s.pending_board_at) then
      update public.autodarts_sessions set pending_board_request_id = null where id = s.id;
      s.pending_board_request_id := null;
      if v_board_status = 200 and jsonb_typeof(v_board_response) = 'array' then
        select b->'state' into v_board from jsonb_array_elements(v_board_response) b where b->>'id' = s.autodarts_board_id limit 1;
      end if;
    end if;
  end if;

  if s.pending_poll_request_id is not null then
    select r.status_code, public._ad_json(r.content)
      into v_status, v_response from net._http_response r where r.id = s.pending_poll_request_id;
    if v_status is null then
      if not public._ad_request_lost(s.pending_poll_request_id, s.pending_poll_at) then
        return jsonb_build_object('status', 'pending') || case when v_board is null then '{}'::jsonb else jsonb_build_object('_board', v_board) end;
      end if;
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
    if p_with_board and s.pending_board_request_id is null and s.autodarts_board_id is not null then
      v_request := net.http_get(url := 'https://api.autodarts.com/bs/v0/boards', headers := public._ad_headers(v_token), timeout_milliseconds := 5000);
      update public.autodarts_sessions set pending_board_request_id = v_request, pending_board_at = now() where id = s.id;
    end if;
  else
    v_request := public._ad_enqueue_refresh(s.host_kind, s.host_ref);
    update public.autodarts_sessions set pending_poll_request_id = v_request, pending_poll_kind = 'refresh', pending_poll_at = now(), updated_at = now() where id = s.id;
  end if;

  if s.pending_poll_kind = 'match_get' and v_status is not null then
    v_result := v_response;
  else
    v_result := coalesce(v_response, jsonb_build_object('status', 'pending'));
  end if;
  if v_board is not null and jsonb_typeof(v_result) = 'object' then
    v_result := v_result || jsonb_build_object('_board', v_board);
  end if;
  return v_result;
end;
$function$;

revoke all on function public.autodarts_session_poll(uuid, boolean) from public, anon;
grant execute on function public.autodarts_session_poll(uuid, boolean) to authenticated;
