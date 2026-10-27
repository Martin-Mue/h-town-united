-- Online-Ausbau: offene Herausforderungen, Vertretung/Abbruch bei Inaktivität, Zuschauer-Lesezugriff
-- und eine reine Online-Rangliste. Alles additiv und wiederholbar (if not exists / or replace).

-- ---------------------------------------------------------------------------------------------
-- Offene Herausforderung: "Ich suche einen Gegner" — jedes Vereinsmitglied mit Konto kann annehmen.
create table if not exists public.online_open_challenges (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  created_by uuid not null references auth.users(id),
  mode text not null check (mode in ('501', '301', 'cricket', 'custom')),
  best_of_legs int not null default 1,
  double_in boolean not null default false,
  double_out boolean not null default true,
  custom_start_score int,
  status text not null default 'open' check (status in ('open', 'taken', 'canceled')),
  taken_by uuid references auth.users(id),
  match_id uuid references public.online_matches(id),
  created_at timestamptz not null default now()
);

-- Pro Mitglied höchstens eine offene Herausforderung gleichzeitig.
create unique index if not exists uq_online_open_challenge_one_per_member
  on public.online_open_challenges(created_by) where status = 'open';

alter table public.online_open_challenges enable row level security;

drop policy if exists "Club members can view open challenges" on public.online_open_challenges;
create policy "Club members can view open challenges"
  on public.online_open_challenges for select to authenticated
  using (club_id = public.current_club_id());

revoke insert, update, delete on public.online_open_challenges from authenticated;

create or replace function public.create_open_challenge(
  _mode text, _best_of_legs int, _double_in boolean, _double_out boolean, _custom_start_score int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_club uuid := public.current_club_id(); v_me uuid := auth.uid(); v_id uuid;
begin
  if v_me is null or v_club is null then raise exception 'Not signed in to a club'; end if;
  if _mode not in ('501', '301', 'cricket', 'custom') then raise exception 'Invalid mode'; end if;
  -- Abgelaufene (älter als 24 h) eigene offene Herausforderung räumen, damit der Unique-Index nicht blockiert.
  update public.online_open_challenges set status = 'canceled'
    where created_by = v_me and status = 'open' and created_at < now() - interval '24 hours';
  insert into public.online_open_challenges (club_id, created_by, mode, best_of_legs, double_in, double_out, custom_start_score)
    values (v_club, v_me, _mode, greatest(1, coalesce(_best_of_legs, 1)), coalesce(_double_in, false), coalesce(_double_out, true), _custom_start_score)
    returning id into v_id;
  return v_id;
end; $$;

create or replace function public.cancel_open_challenge(_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.online_open_challenges set status = 'canceled' where id = _id and created_by = auth.uid() and status = 'open';
end; $$;

-- Annehmen legt ein reguläres 1:1-Match (pending) an; der Annehmende schließt es danach wie jede
-- andere Herausforderung mit accept_online_match ab (Startzustand baut der Client).
create or replace function public.take_open_challenge(_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_c record; v_match uuid;
begin
  select * into v_c from public.online_open_challenges where id = _id and status = 'open' for update;
  if not found then raise exception 'Challenge is no longer open'; end if;
  if v_c.club_id is distinct from public.current_club_id() then raise exception 'Not in this club'; end if;
  if v_c.created_by = auth.uid() then raise exception 'You cannot take your own challenge'; end if;
  if v_c.created_at < now() - interval '24 hours' then raise exception 'Challenge expired'; end if;
  if not exists (select 1 from public.players where club_id = v_c.club_id and user_id = auth.uid()) then
    raise exception 'You need a player profile in this club';
  end if;
  insert into public.online_matches (club_id, source_type, player1_user_id, player2_user_id, status, mode, best_of_legs, created_by, double_in, double_out, custom_start_score, starter)
    values (v_c.club_id, 'casual', v_c.created_by, auth.uid(), 'pending', v_c.mode, v_c.best_of_legs, v_c.created_by, v_c.double_in, v_c.double_out, v_c.custom_start_score, 'random')
    returning id into v_match;
  update public.online_open_challenges set status = 'taken', taken_by = auth.uid(), match_id = v_match where id = _id;
  return v_match;
end; $$;

revoke all on function public.create_open_challenge(text, int, boolean, boolean, int) from public, anon;
revoke all on function public.cancel_open_challenge(uuid) from public, anon;
revoke all on function public.take_open_challenge(uuid) from public, anon;
grant execute on function public.create_open_challenge(text, int, boolean, boolean, int) to authenticated;
grant execute on function public.cancel_open_challenge(uuid) to authenticated;
grant execute on function public.take_open_challenge(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Zuschauer: jedes Vereinsmitglied darf laufende Online-Spiele des eigenen Vereins ansehen.
drop policy if exists "Club members can watch active online matches" on public.online_matches;
create policy "Club members can watch active online matches"
  on public.online_matches for select to authenticated
  using (club_id = public.current_club_id() and status = 'active');

-- ---------------------------------------------------------------------------------------------
-- Vertretung im Doppel: ist der gerade Werfende seit über 60 s nicht zum Zug gekommen, darf sein
-- Partner für ihn werfen (Reihenfolge und Teamstand bleiben unverändert — es zählt weiter der
-- Spieler, dessen Zug es ist). 1:1 bleibt Zeile für Zeile wie vorher.
create or replace function public.submit_online_throw(
  _match_id uuid, _new_game_state jsonb, _new_darts_this_round int, _new_turn_start_remaining int
) returns void
language plpgsql security definer set search_path = public as $$
declare v_match record; v_caller_slot int; v_current_player_index int;
begin
  select * into v_match from online_matches where id = _match_id and status = 'active' for update;
  if not found then raise exception 'Match not found or not active'; end if;
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

-- Abbruch bei langer Inaktivität (5 min ohne Wurf): ein Teilnehmer, der NICHT am Zug ist, beendet
-- das Spiel ohne Wertung — sonst bliebe es für alle Beteiligten ewig "laufend".
create or replace function public.abort_idle_online_match(_match_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_match record; v_slot int; v_current int;
begin
  select * into v_match from online_matches where id = _match_id and status = 'active' for update;
  if not found then return false; end if;
  if not public.is_online_match_member(_match_id) then raise exception 'Not a participant in this match'; end if;
  if v_match.updated_at > now() - interval '5 minutes' then return false; end if;
  v_current := (v_match.game_state->>'currentPlayerIndex')::int;
  if v_match.is_doubles then
    select slot into v_slot from online_match_players where match_id = _match_id and user_id = auth.uid();
    if v_slot is null or v_slot % 2 = v_current % 2 then return false; end if;
  else
    v_slot := case when auth.uid() = v_match.player1_user_id then 0 else 1 end;
    if v_slot = v_current then return false; end if;
  end if;
  update online_matches set status = 'canceled', decline_reason = 'timeout', updated_at = now() where id = _match_id;
  return true;
end; $$;

revoke all on function public.abort_idle_online_match(uuid) from public, anon;
grant execute on function public.abort_idle_online_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Online-Rangliste: nur Spiele, die online gespielt wurden (games.played_online).
create or replace function public.online_leaderboard()
returns table (player_id uuid, name text, emoji text, played bigint, wins bigint, win_rate numeric)
language sql stable security definer set search_path = public as $$
  with seats as (
    select g.winner_id, g.player1_id as pid from public.games g where g.played_online and g.club_id = public.current_club_id() and g.player1_id is not null
    union all
    select g.winner_id, g.player2_id from public.games g where g.played_online and g.club_id = public.current_club_id() and g.player2_id is not null
  )
  select p.id, p.name, p.emoji,
         count(*)::bigint as played,
         count(*) filter (where s.winner_id = p.id)::bigint as wins,
         round(100.0 * count(*) filter (where s.winner_id = p.id) / nullif(count(*), 0), 1) as win_rate
  from seats s join public.players p on p.id = s.pid
  group by p.id, p.name, p.emoji
  order by wins desc, win_rate desc, played desc;
$$;

revoke all on function public.online_leaderboard() from public, anon;
grant execute on function public.online_leaderboard() to authenticated;
