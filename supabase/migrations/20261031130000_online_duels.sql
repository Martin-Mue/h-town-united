-- Fernduell: asynchrones 1:1. Beide Spieler spielen dasselbe Solo-Leg (X01) zu einer beliebigen
-- Zeit innerhalb von 7 Tagen; wer weniger Darts braucht, gewinnt (bei Gleichstand der höhere
-- Average). Das Ergebnis des Gegners bleibt verborgen, bis man selbst fertig ist.
--
-- Bewusst KEINE direkte Leseberechtigung auf die Tabelle: sonst könnte man das Ergebnis des
-- Gegners vor dem eigenen Wurf abfragen. Gelesen wird ausschließlich über my_online_duels(), das
-- das Gegner-Ergebnis erst herausgibt, wenn man selbst fertig ist (oder das Duell beendet ist).

create table if not exists public.online_duels (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  challenger_user_id uuid not null references auth.users(id),
  opponent_user_id uuid not null references auth.users(id),
  mode text not null check (mode in ('501', '301', 'custom')),
  custom_start_score int,
  double_in boolean not null default false,
  double_out boolean not null default true,
  -- pending = Gegner hat noch nicht zugesagt; active = läuft; finished = beide fertig;
  -- declined/canceled = abgebrochen. Ablauf (expires_at) wird nicht gespeichert, sondern beim Lesen ausgewertet.
  status text not null default 'pending' check (status in ('pending', 'active', 'finished', 'declined', 'canceled')),
  decline_reason text,
  expires_at timestamptz not null default (now() + interval '7 days'),
  challenger_darts int,
  challenger_average numeric,
  challenger_finished_at timestamptz,
  opponent_darts int,
  opponent_average numeric,
  opponent_finished_at timestamptz,
  winner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (challenger_user_id <> opponent_user_id)
);

create index if not exists idx_online_duels_challenger on public.online_duels(challenger_user_id);
create index if not exists idx_online_duels_opponent on public.online_duels(opponent_user_id);

alter table public.online_duels enable row level security;
revoke all on public.online_duels from authenticated, anon;

create or replace function public.create_online_duel(
  _opponent uuid, _mode text, _custom_start_score int, _double_in boolean, _double_out boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_club uuid := public.current_club_id(); v_me uuid := auth.uid(); v_id uuid;
begin
  if v_me is null or v_club is null then raise exception 'Not signed in to a club'; end if;
  if _opponent is null or _opponent = v_me then raise exception 'Pick another player'; end if;
  if _mode not in ('501', '301', 'custom') then raise exception 'Invalid mode'; end if;
  if not exists (select 1 from public.players where club_id = v_club and user_id = _opponent) then
    raise exception 'Opponent needs an account in your club';
  end if;
  insert into public.online_duels (club_id, challenger_user_id, opponent_user_id, mode, custom_start_score, double_in, double_out)
    values (v_club, v_me, _opponent, _mode, _custom_start_score, coalesce(_double_in, false), coalesce(_double_out, true))
    returning id into v_id;
  return v_id;
end; $$;

create or replace function public.respond_online_duel(_id uuid, _accept boolean, _reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_d record;
begin
  select * into v_d from public.online_duels where id = _id for update;
  if not found or v_d.opponent_user_id is distinct from auth.uid() then raise exception 'Duel not found'; end if;
  if v_d.status <> 'pending' then return v_d.status; end if;
  if _accept then
    update public.online_duels set status = 'active', expires_at = now() + interval '7 days' where id = _id;
    return 'active';
  end if;
  update public.online_duels set status = 'declined', decline_reason = nullif(btrim(coalesce(_reason, '')), '') where id = _id;
  return 'declined';
end; $$;

create or replace function public.cancel_online_duel(_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.online_duels set status = 'canceled'
    where id = _id and challenger_user_id = auth.uid() and status in ('pending', 'active');
end; $$;

-- Eigenes Ergebnis eintragen (einmalig). Sind beide fertig, wird der Gewinner bestimmt:
-- weniger Darts gewinnt, bei Gleichstand der höhere Average, sonst Unentschieden (winner null).
create or replace function public.submit_online_duel_result(_id uuid, _darts int, _average numeric) returns text
language plpgsql security definer set search_path = public as $$
declare v_d record; v_is_challenger boolean; v_winner uuid;
begin
  select * into v_d from public.online_duels where id = _id for update;
  if not found or auth.uid() not in (v_d.challenger_user_id, v_d.opponent_user_id) then raise exception 'Duel not found'; end if;
  if v_d.status <> 'active' then raise exception 'Duel is not active'; end if;
  if v_d.expires_at < now() then raise exception 'Duel has expired'; end if;
  if _darts is null or _darts < 1 or _darts > 1000 then raise exception 'Invalid result'; end if;
  v_is_challenger := auth.uid() = v_d.challenger_user_id;
  if (v_is_challenger and v_d.challenger_finished_at is not null) or (not v_is_challenger and v_d.opponent_finished_at is not null) then
    return v_d.status;
  end if;
  if v_is_challenger then
    update public.online_duels set challenger_darts = _darts, challenger_average = _average, challenger_finished_at = now() where id = _id;
  else
    update public.online_duels set opponent_darts = _darts, opponent_average = _average, opponent_finished_at = now() where id = _id;
  end if;
  select * into v_d from public.online_duels where id = _id;
  if v_d.challenger_finished_at is not null and v_d.opponent_finished_at is not null then
    v_winner := case
      when v_d.challenger_darts < v_d.opponent_darts then v_d.challenger_user_id
      when v_d.challenger_darts > v_d.opponent_darts then v_d.opponent_user_id
      when v_d.challenger_average > v_d.opponent_average then v_d.challenger_user_id
      when v_d.challenger_average < v_d.opponent_average then v_d.opponent_user_id
      else null end;
    update public.online_duels set status = 'finished', winner_user_id = v_winner where id = _id;
    return 'finished';
  end if;
  return 'active';
end; $$;

-- Lesezugriff: nur eigene Duelle; das Ergebnis des Gegners erst, wenn man selbst fertig ist oder
-- das Duell beendet/abgelaufen ist. "expired" = Frist abgelaufen ohne dass beide gespielt haben.
create or replace function public.my_online_duels()
returns table (
  id uuid, challenger_user_id uuid, opponent_user_id uuid, mode text, custom_start_score int,
  double_in boolean, double_out boolean, status text, decline_reason text, expires_at timestamptz,
  my_darts int, my_average numeric, my_finished boolean,
  their_darts int, their_average numeric, their_finished boolean,
  winner_user_id uuid, expired boolean, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select d.id, d.challenger_user_id, d.opponent_user_id, d.mode, d.custom_start_score, d.double_in, d.double_out,
         d.status, d.decline_reason, d.expires_at,
         case when auth.uid() = d.challenger_user_id then d.challenger_darts else d.opponent_darts end,
         case when auth.uid() = d.challenger_user_id then d.challenger_average else d.opponent_average end,
         (case when auth.uid() = d.challenger_user_id then d.challenger_finished_at else d.opponent_finished_at end) is not null,
         case when (case when auth.uid() = d.challenger_user_id then d.challenger_finished_at else d.opponent_finished_at end) is not null or d.status = 'finished'
              then (case when auth.uid() = d.challenger_user_id then d.opponent_darts else d.challenger_darts end) end,
         case when (case when auth.uid() = d.challenger_user_id then d.challenger_finished_at else d.opponent_finished_at end) is not null or d.status = 'finished'
              then (case when auth.uid() = d.challenger_user_id then d.opponent_average else d.challenger_average end) end,
         (case when auth.uid() = d.challenger_user_id then d.opponent_finished_at else d.challenger_finished_at end) is not null,
         d.winner_user_id,
         (d.status in ('pending', 'active') and d.expires_at < now()),
         d.created_at
  from public.online_duels d
  where (auth.uid() in (d.challenger_user_id, d.opponent_user_id))
    and d.club_id = public.current_club_id()
    and d.created_at > now() - interval '30 days'
  order by d.created_at desc;
$$;

revoke all on function public.create_online_duel(uuid, text, int, boolean, boolean) from public, anon;
revoke all on function public.respond_online_duel(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_online_duel(uuid) from public, anon;
revoke all on function public.submit_online_duel_result(uuid, int, numeric) from public, anon;
revoke all on function public.my_online_duels() from public, anon;
grant execute on function public.create_online_duel(uuid, text, int, boolean, boolean) to authenticated;
grant execute on function public.respond_online_duel(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_online_duel(uuid) to authenticated;
grant execute on function public.submit_online_duel_result(uuid, int, numeric) to authenticated;
grant execute on function public.my_online_duels() to authenticated;
