-- Adds gl.leg_number to public_tournament_highlights so the Live-Ansicht/Highlights panel can
-- group a match's legs in play order for a per-leg average drill-down (previously only game_id
-- was available, enough to pool legs by match but not to order them within it). Return type is
-- changing, so this needs drop+recreate, not create-or-replace (same Postgres restriction noted
-- in 20260819220000_extend_public_tournament_highlights_with_averages.sql). Verified the live
-- function body against pg_get_functiondef before writing this — matches that prior migration
-- file exactly, so this is a clean append, not a drift-correction.
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
  player2_average numeric,
  leg_number integer
)
language sql
security definer
set search_path = public
stable
as $$
  select gl.player_id, gl.player_name, gl.starting_score, gl.throws, gl.won,
         g.id, g.player1_id, g.player1_name, g.player1_average, g.player2_id, g.player2_name, g.player2_average,
         gl.leg_number
  from game_legs gl
  join games g on g.id = gl.game_id
  where g.tournament_id = _tournament_id
    and exists (
      select 1 from tournaments t
      where t.id = _tournament_id and t.public_view = true
    );
$$;

grant execute on function public.public_tournament_highlights(uuid) to anon, authenticated;
