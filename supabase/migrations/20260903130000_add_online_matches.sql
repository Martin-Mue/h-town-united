-- Online-Live-Spiel Phase 1: zwei eingeloggte Vereinsmitglieder spielen dasselbe Match auf zwei
-- Geräten. Neue Tabelle statt Wiederverwendung von `games`: `games` ist der Rückblick-Datensatz
-- eines ABGESCHLOSSENEN Spiels (Statistics.tsx/Home-Feed/Elo erwarten fertige Zeilen), kein
-- lebendiger, laufend überschriebener Zustand.
create table public.online_matches (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  -- 'casual' (Phase 1, direkte Herausforderung) | 'league' | 'tournament' (spätere Phasen,
  -- source_id verweist dann auf die jeweilige fixture_id bzw. "tournamentId:matchId").
  source_type text not null default 'casual' check (source_type in ('casual','league','tournament')),
  source_id text,
  player1_user_id uuid not null references auth.users(id),
  player2_user_id uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','active','finished','declined','canceled')),
  mode text not null check (mode in ('501','301','cricket')),
  best_of_legs int not null default 1,
  -- Volles GameState (players/legsWon/currentLeg/completedLegs/currentPlayerIndex/...) PLUS
  -- dartsThisRound/turnStartRemaining, die im lokalen Spiel heute Geschwister-States außerhalb
  -- von GameState sind (src/types/game.ts) — hier müssen sie mit rein, sonst ist ein Reconnect
  -- nicht vollständig rekonstruierbar. Erst gesetzt sobald status='active'.
  game_state jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (player1_user_id <> player2_user_id)
);

create index idx_online_matches_players on public.online_matches(player1_user_id, player2_user_id);
create index idx_online_matches_club on public.online_matches(club_id);

alter table public.online_matches enable row level security;

create policy "Participants can view their online matches"
  on public.online_matches for select to authenticated
  using (club_id = public.current_club_id() and auth.uid() in (player1_user_id, player2_user_id));

create policy "Club members can create online match challenges"
  on public.online_matches for insert to authenticated
  with check (
    club_id = public.current_club_id()
    and created_by = auth.uid()
    and auth.uid() in (player1_user_id, player2_user_id)
  );

create policy "Participants can update their online match status"
  on public.online_matches for update to authenticated
  using (club_id = public.current_club_id() and auth.uid() in (player1_user_id, player2_user_id));

-- The row-level policy above is intentionally broad (any participant can UPDATE the row) — the
-- real restriction is column-level: only `status` is directly client-writable (accept/decline/
-- cancel a challenge). `game_state` is deliberately excluded from this grant, same lesson as the
-- clubs billing-column fix earlier the same day (a broad table-level grant would silently let a
-- client overwrite game_state directly, bypassing the turn-ownership check that only
-- submit_online_throw() below enforces).
revoke update on public.online_matches from authenticated;
grant update (status) on public.online_matches to authenticated;

-- The ONLY sanctioned path to change game_state once a match is active. Deliberately narrow: it
-- does NOT re-simulate dart scoring server-side (no reimplementation of handleX01Throw's rules
-- engine in SQL) — it trusts the client's own computation of the new state, the same engine
-- already used for every local/bot game. The one thing it DOES enforce server-side is the one
-- invariant a client-side-only check can't be trusted for: that the caller was actually the
-- player whose turn it was in the PREVIOUS stored state before accepting their update. This is a
-- pragmatic middle ground, not a fully adversarial-proof design — matches this app's existing
-- risk tolerance for casual, low-stakes club features (see match_predictions' own "not real
-- anti-abuse" note); a determined cheater could still submit a fabricated but turn-valid state.
create or replace function public.submit_online_throw(
  _match_id uuid,
  _new_game_state jsonb,
  _new_darts_this_round int,
  _new_turn_start_remaining int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_caller_slot int;
  v_current_player_index int;
begin
  select * into v_match from online_matches where id = _match_id and status = 'active' for update;
  if not found then
    raise exception 'Match not found or not active';
  end if;
  if auth.uid() is distinct from v_match.player1_user_id and auth.uid() is distinct from v_match.player2_user_id then
    raise exception 'Not a participant in this match';
  end if;
  v_caller_slot := case when auth.uid() = v_match.player1_user_id then 0 else 1 end;
  v_current_player_index := (v_match.game_state->>'currentPlayerIndex')::int;
  if v_current_player_index is distinct from v_caller_slot then
    raise exception 'Not your turn';
  end if;
  update online_matches
  set game_state = _new_game_state || jsonb_build_object(
        'dartsThisRound', _new_darts_this_round,
        'turnStartRemaining', _new_turn_start_remaining
      ),
      updated_at = now()
  where id = _match_id;
end;
$$;

revoke all on function public.submit_online_throw(uuid, jsonb, int, int) from public, anon;
grant execute on function public.submit_online_throw(uuid, jsonb, int, int) to authenticated;

-- Accepting a pending challenge needs to ALSO seed the initial game_state (which the plain
-- `status` column grant above can't do, since game_state isn't in that grant) — a second small
-- RPC rather than widening the client's direct UPDATE grant.
create or replace function public.accept_online_match(_match_id uuid, _initial_game_state jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
begin
  select * into v_match from online_matches where id = _match_id and status = 'pending' for update;
  if not found then
    raise exception 'Challenge not found or already resolved';
  end if;
  if auth.uid() is distinct from v_match.player2_user_id then
    raise exception 'Only the challenged player can accept';
  end if;
  update online_matches
  set status = 'active', game_state = _initial_game_state, updated_at = now()
  where id = _match_id;
end;
$$;

revoke all on function public.accept_online_match(uuid, jsonb) from public, anon;
grant execute on function public.accept_online_match(uuid, jsonb) to authenticated;
