-- Extends public_tournament_highlights with the per-game average columns (from `games`, not
-- `game_legs`) so the anonymous Live-Ansicht can show tournament/game averages too — these work
-- for a tournament played entirely without the camera, unlike the heatmap/180/triple/bull counts
-- which need real per-dart records. Piggybacks on the existing per-leg rows (each leg's game
-- averages repeated once per leg of that game) rather than a second RPC/round-trip; the client
-- de-duplicates by game_id. Return type is changing, so this needs drop+recreate, not
-- create-or-replace (Postgres disallows changing an existing function's output columns in place).
drop function if exists public.public_tournament_highlights(uuid);

create or replace function public.public_tournament_highlights(_tournament_id uuid)
returns table (
  player_id uuid,
  player_name text,
  starting_score integer,
  throws jsonb,
  won boolean,
  game_id uuid,
  player1_id uuid,
  player1_name text,
  player1_average numeric,
  player2_id uuid,
  player2_name text,
  player2_average numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select gl.player_id, gl.player_name, gl.starting_score, gl.throws, gl.won,
         g.id, g.player1_id, g.player1_name, g.player1_average, g.player2_id, g.player2_name, g.player2_average
  from game_legs gl
  join games g on g.id = gl.game_id
  where g.tournament_id = _tournament_id
    and exists (
      select 1 from tournaments t
      where t.id = _tournament_id and t.public_view = true
    );
$$;

grant execute on function public.public_tournament_highlights(uuid) to anon, authenticated;
