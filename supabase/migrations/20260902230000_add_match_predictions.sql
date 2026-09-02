-- Spectator bracket predictions on the public live view (PublicTournament.tsx) — the app's FIRST
-- anonymous-write surface, so deliberately routed entirely through two tightly-scoped SECURITY
-- DEFINER RPCs rather than a raw anon INSERT/SELECT policy on the table: cast_match_prediction
-- validates everything server-side (tournament is actually public, the match exists and hasn't
-- been decided, the guessed name is one of the two real players currently in that slot) before
-- writing, and get_match_predictions only ever returns aggregated counts, never the raw per-voter
-- rows. The base table carries NO policies at all for anon/authenticated — both directions are
-- RPC-only, RLS just needs to be ON to block any other access path by default.
--
-- Known, accepted limitation: voter_id is a random UUID the client generates and stores in
-- localStorage (see useMatchPredictions.ts) — enough to stop a casual accidental double-vote or
-- re-vote-on-refresh, NOT a defense against someone scripting the RPC directly with many random
-- voter_ids. Deliberately not building real anti-abuse (CAPTCHA/rate-limiting) for what is a
-- low-stakes casual spectator feature on a small club's tournament page — flagged here plainly
-- rather than implying a guarantee this doesn't provide.
create table public.match_predictions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(id),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  -- Match.id from the tournament's own `bracket` jsonb (see src/utils/tournament.ts) — KO
  -- brackets only for now, not round-robin (round-robin matches live in a different shape; see
  -- useMatchPredictions.ts for where this is enforced client-side).
  match_id text not null,
  voter_id uuid not null,
  predicted_winner text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, match_id, voter_id)
);

create index idx_match_predictions_tournament on public.match_predictions(tournament_id);

alter table public.match_predictions enable row level security;

create or replace function public.cast_match_prediction(
  _tournament_id uuid,
  _match_id text,
  _voter_id uuid,
  _predicted_winner text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_match jsonb;
begin
  select club_id into v_club_id
  from tournaments
  where id = _tournament_id and public_view = true;

  if v_club_id is null then
    raise exception 'Tournament not found or not public.';
  end if;

  select elem into v_match
  from tournaments t, jsonb_array_elements(t.bracket) elem
  where t.id = _tournament_id and elem->>'id' = _match_id
  limit 1;

  if v_match is null then
    raise exception 'Match not found.';
  end if;

  if coalesce(v_match->>'winner', '') <> '' then
    raise exception 'This match has already been decided.';
  end if;

  if coalesce(v_match->>'player1', '') in ('', 'BYE') or coalesce(v_match->>'player2', '') in ('', 'BYE') then
    raise exception 'This match is not ready to be predicted yet.';
  end if;

  if _predicted_winner is distinct from (v_match->>'player1') and _predicted_winner is distinct from (v_match->>'player2') then
    raise exception 'Invalid prediction.';
  end if;

  insert into match_predictions (club_id, tournament_id, match_id, voter_id, predicted_winner)
  values (v_club_id, _tournament_id, _match_id, _voter_id, _predicted_winner)
  on conflict (tournament_id, match_id, voter_id)
  do update set predicted_winner = excluded.predicted_winner, updated_at = now();
end;
$$;

revoke all on function public.cast_match_prediction(uuid, text, uuid, text) from public;
grant execute on function public.cast_match_prediction(uuid, text, uuid, text) to anon, authenticated;

create or replace function public.get_match_predictions(_tournament_id uuid)
returns table (match_id text, predicted_winner text, votes bigint)
language sql
security definer
set search_path = public
stable
as $$
  select mp.match_id, mp.predicted_winner, count(*) as votes
  from match_predictions mp
  where mp.tournament_id = _tournament_id
    and exists (select 1 from tournaments t where t.id = _tournament_id and t.public_view = true)
  group by mp.match_id, mp.predicted_winner;
$$;

grant execute on function public.get_match_predictions(uuid) to anon, authenticated;
