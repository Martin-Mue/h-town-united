-- Lets the anonymous public Live-Ansicht (PublicTournament.tsx) show per-participant highlight
-- stats (180s, big triples, bull hits, ton-plus finishes) and a throw heatmap for a tournament,
-- without opening broad anon read access to games/game_legs (both stay authenticated-only, see
-- 20260816090000_security_advisor_fixes.sql). SECURITY DEFINER bypasses RLS internally, but the
-- "public_view = true" guard below is the actual safety boundary — the exact same condition
-- tournaments_public already uses to decide what an anonymous viewer may see at all.
create or replace function public.public_tournament_highlights(_tournament_id uuid)
returns table (
  player_id uuid,
  player_name text,
  starting_score integer,
  throws jsonb,
  won boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select gl.player_id, gl.player_name, gl.starting_score, gl.throws, gl.won
  from game_legs gl
  join games g on g.id = gl.game_id
  where g.tournament_id = _tournament_id
    and exists (
      select 1 from tournaments t
      where t.id = _tournament_id and t.public_view = true
    );
$$;

grant execute on function public.public_tournament_highlights(uuid) to anon, authenticated;
