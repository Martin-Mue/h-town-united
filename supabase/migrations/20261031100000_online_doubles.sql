-- Online-Doppel: vier Vereinsmitglieder spielen ein 2-gegen-2 von vier Geräten aus, jeder zu Hause.
--
-- Slots == Index in GameState.players. Das Team-Spiel interleaved bereits [A1, B1, A2, B2]
-- (siehe types/game.ts, teamIndexFor), also gilt: slot 0 = Spielführer (Team A), slot 1 = erster
-- Gegner (Team B), slot 2 = Partner (Team A), slot 3 = zweiter Gegner (Team B). Team = slot % 2.
-- online_matches.player1_user_id/player2_user_id bleiben deshalb exakt Slot 0/1 — jede bestehende
-- Abfrage und die 1:1-Zugprüfung gelten für diese beiden unverändert weiter; nur Slot 2/3 leben
-- zusätzlich in online_match_players.
--
-- Alles additiv und mit if-not-exists/or-replace, damit die Datei auch dann sicher (erneut)
-- laufen kann, wenn der Lovable-Editor sie schon direkt auf die Live-DB angewendet hat.

alter table public.online_matches
  add column if not exists is_doubles boolean not null default false,
  add column if not exists team_names jsonb;

comment on column public.online_matches.is_doubles is
  'true = 2-gegen-2 mit vier Konten (siehe online_match_players); false = klassisches 1:1.';
comment on column public.online_matches.team_names is
  'Optionale Teamnamen [Team A, Team B] für ein Doppel; null = aus den Spielernamen abgeleitet.';

create table if not exists public.online_match_players (
  match_id uuid not null references public.online_matches(id) on delete cascade,
  slot int not null check (slot between 0 and 3),
  user_id uuid not null references auth.users(id),
  -- 'accepted' für den Spielführer von Anfang an; alle anderen starten als 'invited'.
  status text not null default 'invited' check (status in ('invited', 'accepted', 'declined')),
  decline_reason text,
  responded_at timestamptz,
  primary key (match_id, slot),
  unique (match_id, user_id)
);

create index if not exists idx_online_match_players_user on public.online_match_players(user_id);

alter table public.online_match_players enable row level security;

-- Hilfsfunktionen als SECURITY DEFINER, damit die Policies sich nicht rekursiv über
-- online_match_players selbst lesen müssen.
create or replace function public.is_online_match_member(_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.online_match_players where match_id = _match_id and user_id = auth.uid())
      or exists (select 1 from public.online_matches where id = _match_id and auth.uid() in (player1_user_id, player2_user_id));
$$;

revoke all on function public.is_online_match_member(uuid) from public, anon;
grant execute on function public.is_online_match_member(uuid) to authenticated;

drop policy if exists "Members can view online match players" on public.online_match_players;
create policy "Members can view online match players"
  on public.online_match_players for select to authenticated
  using (public.is_online_match_member(match_id));

-- Spieler 3/4 eines Doppels sehen das Match ebenfalls (die bestehende Policy kennt nur Slot 0/1).
drop policy if exists "Doubles participants can view their online matches" on public.online_matches;
create policy "Doubles participants can view their online matches"
  on public.online_matches for select to authenticated
  using (club_id = public.current_club_id() and is_doubles and public.is_online_match_member(id));

-- Schreiben ausschließlich über die RPCs unten.
revoke insert, update, delete on public.online_match_players from authenticated;

-- ---------------------------------------------------------------------------------------------
-- Doppel anlegen: Spielführer + Partner + zwei Gegner. Alles in einer Transaktion, alle vier
-- müssen eigenes Konto im selben Verein haben.
create or replace function public.create_online_doubles_match(
  _mode text,
  _best_of_legs int,
  _double_in boolean,
  _double_out boolean,
  _custom_start_score int,
  _starter text,
  _partner uuid,
  _opponent1 uuid,
  _opponent2 uuid,
  _team_names jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club uuid := public.current_club_id();
  v_me uuid := auth.uid();
  v_id uuid;
  v_ids uuid[] := array[v_me, _opponent1, _partner, _opponent2];
begin
  if v_me is null or v_club is null then
    raise exception 'Not signed in to a club';
  end if;
  if _partner is null or _opponent1 is null or _opponent2 is null
     or (select count(distinct x) from unnest(v_ids) x) <> 4 then
    raise exception 'A doubles match needs four different players';
  end if;
  if (select count(*) from public.players where club_id = v_club and user_id = any (v_ids)) <> 4 then
    raise exception 'All four players need an account in your club';
  end if;
  if _mode not in ('501', '301', 'cricket', 'custom') then
    raise exception 'Invalid mode';
  end if;

  insert into public.online_matches (
    club_id, source_type, player1_user_id, player2_user_id, status, mode, best_of_legs,
    created_by, double_in, double_out, custom_start_score, starter, is_doubles, team_names
  ) values (
    v_club, 'casual', v_me, _opponent1, 'pending', _mode, greatest(1, coalesce(_best_of_legs, 1)),
    v_me, coalesce(_double_in, false), coalesce(_double_out, true), _custom_start_score,
    coalesce(_starter, 'challenger'), true, _team_names
  ) returning id into v_id;

  insert into public.online_match_players (match_id, slot, user_id, status, responded_at) values
    (v_id, 0, v_me, 'accepted', now()),
    (v_id, 1, _opponent1, 'invited', null),
    (v_id, 2, _partner, 'invited', null),
    (v_id, 3, _opponent2, 'invited', null);

  return v_id;
end;
$$;

revoke all on function public.create_online_doubles_match(text, int, boolean, boolean, int, text, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.create_online_doubles_match(text, int, boolean, boolean, int, text, uuid, uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Zusagen/Absagen. Sagt jemand ab, ist das ganze Doppel abgesagt (Absagegrund wie beim 1:1).
-- Wer als Letzter zusagt, startet das Spiel: der Client übergibt den fertigen Startzustand, der
-- nur verwendet wird, wenn nach dieser Zusage alle vier zugesagt haben.
create or replace function public.respond_online_doubles(
  _match_id uuid,
  _accept boolean,
  _reason text default null,
  _initial_game_state jsonb default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_open int;
begin
  select * into v_match from public.online_matches where id = _match_id and is_doubles for update;
  if not found then
    raise exception 'Doubles match not found';
  end if;
  if v_match.status <> 'pending' then
    return v_match.status;
  end if;
  if not exists (select 1 from public.online_match_players where match_id = _match_id and user_id = auth.uid()) then
    raise exception 'Not a participant in this match';
  end if;

  if not _accept then
    update public.online_match_players
      set status = 'declined', decline_reason = nullif(btrim(coalesce(_reason, '')), ''), responded_at = now()
      where match_id = _match_id and user_id = auth.uid();
    update public.online_matches
      set status = 'declined', decline_reason = nullif(btrim(coalesce(_reason, '')), ''), updated_at = now()
      where id = _match_id;
    return 'declined';
  end if;

  update public.online_match_players
    set status = 'accepted', responded_at = now()
    where match_id = _match_id and user_id = auth.uid();

  select count(*) into v_open from public.online_match_players where match_id = _match_id and status <> 'accepted';
  if v_open = 0 and _initial_game_state is not null then
    update public.online_matches
      set status = 'active', game_state = _initial_game_state, updated_at = now()
      where id = _match_id;
    return 'active';
  end if;
  return 'pending';
end;
$$;

revoke all on function public.respond_online_doubles(uuid, boolean, text, jsonb) from public, anon;
grant execute on function public.respond_online_doubles(uuid, boolean, text, jsonb) to authenticated;

-- Der Spielführer darf ein noch offenes Doppel zurückziehen (der bestehende Status-Update-Grant
-- deckt das für Slot 0/1 schon ab; diese Funktion gilt für alle Teilnehmer eines offenen Doppels).
create or replace function public.cancel_online_doubles(_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.online_matches
    set status = 'canceled', updated_at = now()
    where id = _match_id and is_doubles and status in ('pending', 'active') and created_by = auth.uid();
end;
$$;

revoke all on function public.cancel_online_doubles(uuid) from public, anon;
grant execute on function public.cancel_online_doubles(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Zugprüfung für alle Spiele. 1:1 bleibt Zeile für Zeile wie vorher (Slot aus player1/player2);
-- bei einem Doppel kommt der Slot des Aufrufers aus online_match_players.
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
  if v_match.is_doubles then
    select slot into v_caller_slot from online_match_players where match_id = _match_id and user_id = auth.uid();
    if v_caller_slot is null then
      raise exception 'Not a participant in this match';
    end if;
  else
    if auth.uid() is distinct from v_match.player1_user_id and auth.uid() is distinct from v_match.player2_user_id then
      raise exception 'Not a participant in this match';
    end if;
    v_caller_slot := case when auth.uid() = v_match.player1_user_id then 0 else 1 end;
  end if;
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

-- Echtzeit: Spielstand-Updates sollen auch bei Spieler 3/4 ankommen.
do $$
begin
  alter publication supabase_realtime add table public.online_match_players;
exception when duplicate_object then null;
end $$;
