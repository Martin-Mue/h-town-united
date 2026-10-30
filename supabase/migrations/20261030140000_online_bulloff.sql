-- Bull-off vor dem ersten Leg eines Online-Spiels: jede Seite wirft EINEN Dart auf die Mitte, der
-- nähere beginnt. Der Zustand liegt im geteilten game_state (bullOff: distances in mm für Spieler
-- 0/1, round, resolved, winner). Der Server nimmt jede Distanz genau einmal je Runde an, entscheidet
-- sobald beide da sind (näher gewinnt, unter 1,5 mm = Gleichstand -> neue Runde) und setzt dann den
-- Gewinner als Starter von Leg 1. Im Doppel werfen die Teamerster (Slot 0 und 1).

alter table public.online_matches drop constraint if exists online_matches_starter_check;
alter table public.online_matches add constraint online_matches_starter_check
  check (starter in ('challenger', 'opponent', 'random', 'bulloff'));

create or replace function public.submit_online_bulloff(_match_id uuid, _distance_mm numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_match record; v_slot int; v_state jsonb; v_d0 numeric; v_d1 numeric; v_round int; v_win int;
begin
  select * into v_match from online_matches where id = _match_id and status = 'active' for update;
  if not found then raise exception 'Match not found or not active'; end if;
  v_state := v_match.game_state;
  if v_state->'bullOff' is null or coalesce((v_state->'bullOff'->>'resolved')::boolean, false) then
    raise exception 'No bull-off pending';
  end if;
  if v_match.is_doubles then
    select slot into v_slot from online_match_players where match_id = _match_id and user_id = auth.uid();
  else
    v_slot := case when auth.uid() = v_match.player1_user_id then 0 when auth.uid() = v_match.player2_user_id then 1 else null end;
  end if;
  if v_slot is null then raise exception 'Not a participant in this match'; end if;
  if v_slot > 1 then raise exception 'Only the team starters throw in the bull-off'; end if;
  if _distance_mm is null or _distance_mm < 0 or _distance_mm > 400 then raise exception 'Invalid distance'; end if;
  -- each side counts once per round
  if jsonb_typeof(v_state->'bullOff'->'distances'->v_slot) = 'number' then
    return v_state->'bullOff';
  end if;
  v_round := coalesce((v_state->'bullOff'->>'round')::int, 1);
  v_state := jsonb_set(v_state, array['bullOff', 'distances', v_slot::text], to_jsonb(_distance_mm));
  v_d0 := nullif(v_state->'bullOff'->'distances'->>0, '')::numeric;
  v_d1 := nullif(v_state->'bullOff'->'distances'->>1, '')::numeric;
  if v_d0 is not null and v_d1 is not null then
    if abs(v_d0 - v_d1) < 1.5 then
      v_state := jsonb_set(v_state, '{bullOff}', jsonb_build_object('distances', jsonb_build_array(null, null), 'round', v_round + 1, 'resolved', false));
    else
      v_win := case when v_d0 < v_d1 then 0 else 1 end;
      v_state := jsonb_set(v_state, '{currentPlayerIndex}', to_jsonb(v_win));
      v_state := jsonb_set(v_state, '{currentLeg,startingPlayerIndex}', to_jsonb(v_win));
      v_state := jsonb_set(v_state, '{bullOff}', jsonb_build_object('distances', jsonb_build_array(v_d0, v_d1), 'round', v_round, 'resolved', true, 'winner', v_win));
    end if;
  end if;
  update online_matches set game_state = v_state, updated_at = now() where id = _match_id;
  return v_state->'bullOff';
end; $$;

revoke all on function public.submit_online_bulloff(uuid, numeric) from public, anon;
grant execute on function public.submit_online_bulloff(uuid, numeric) to authenticated;

-- Während ein Bull-off läuft, sind Würfe gesperrt (sonst könnte ein früher Client den Starter umgehen).
-- Sonst unverändert gegenüber 20261030..:  Teamkamerad-Vertretung im Doppel, 1:1 wie vorher.
create or replace function public.submit_online_throw(
  _match_id uuid, _new_game_state jsonb, _new_darts_this_round int, _new_turn_start_remaining int
) returns void
language plpgsql security definer set search_path = public as $$
declare v_match record; v_caller_slot int; v_current_player_index int;
begin
  select * into v_match from online_matches where id = _match_id and status = 'active' for update;
  if not found then raise exception 'Match not found or not active'; end if;
  if coalesce((v_match.game_state->'bullOff'->>'resolved')::boolean, true) = false then
    raise exception 'Bull-off pending';
  end if;
  v_current_player_index := (v_match.game_state->>'currentPlayerIndex')::int;
  if v_match.is_doubles then
    select slot into v_caller_slot from online_match_players where match_id = _match_id and user_id = auth.uid();
    if v_caller_slot is null then raise exception 'Not a participant in this match'; end if;
    if v_current_player_index is distinct from v_caller_slot then
      if not (v_current_player_index % 2 = v_caller_slot % 2 and v_match.updated_at < now() - interval '60 seconds') then
        raise exception 'Not your turn';
      end if;
    end if;
  else
    if auth.uid() is distinct from v_match.player1_user_id and auth.uid() is distinct from v_match.player2_user_id then
      raise exception 'Not a participant in this match';
    end if;
    v_caller_slot := case when auth.uid() = v_match.player1_user_id then 0 else 1 end;
    if v_current_player_index is distinct from v_caller_slot then raise exception 'Not your turn'; end if;
  end if;
  update online_matches
  set game_state = _new_game_state || jsonb_build_object('dartsThisRound', _new_darts_this_round, 'turnStartRemaining', _new_turn_start_remaining),
      updated_at = now()
  where id = _match_id;
end; $$;

revoke all on function public.submit_online_throw(uuid, jsonb, int, int) from public, anon;
grant execute on function public.submit_online_throw(uuid, jsonb, int, int) to authenticated;
