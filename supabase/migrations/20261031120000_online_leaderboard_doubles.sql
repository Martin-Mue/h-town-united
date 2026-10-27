-- Online-Rangliste: im Doppel zählen jetzt ALLE Teammitglieder, nicht nur der Vertreter des Teams.
--
-- games.player1_id/player2_id benennen bei einem Team-Spiel nur einen Vertreter pro Team (siehe
-- saveGameRecord). Vollständig steckt jedes Mitglied in detail_stats->'players' (Reihenfolge =
-- GameState.players, also [A1, B1, A2, B2] -> Team = Index % 2) mit seiner player_id. Gewinnerteam:
-- winner_name ist bei Teams der Teamname und player1_name/player2_name die Teamnamen von Team A/B;
-- als Rückfallebene dient die winner_id des Vertreters (Index 0 = Team A, Index 1 = Team B).
-- Einzelspiele zählen unverändert über player1_id/player2_id.
create or replace function public.online_leaderboard()
returns table (player_id uuid, name text, emoji text, played bigint, wins bigint, win_rate numeric)
language sql stable security definer set search_path = public as $$
  with online_games as (
    select g.* from public.games g where g.played_online and g.club_id = public.current_club_id()
  ),
  single_seats as (
    select g.winner_id, g.player1_id as pid from online_games g
      where coalesce(g.detail_stats->>'isTeamGame', 'false') <> 'true' and g.player1_id is not null
    union all
    select g.winner_id, g.player2_id from online_games g
      where coalesce(g.detail_stats->>'isTeamGame', 'false') <> 'true' and g.player2_id is not null
  ),
  team_seats as (
    select
      case
        when g.winner_name is not distinct from g.player1_name then 0
        when g.winner_name is not distinct from g.player2_name then 1
        when g.winner_id is not null and g.winner_id = (g.detail_stats->'players'->0->>'player_id')::uuid then 0
        when g.winner_id is not null and g.winner_id = (g.detail_stats->'players'->1->>'player_id')::uuid then 1
        else null
      end as winning_team,
      (e.idx - 1) % 2 as team,
      nullif(e.item->>'player_id', '')::uuid as pid
    from online_games g
    cross join lateral jsonb_array_elements(g.detail_stats->'players') with ordinality as e(item, idx)
    where g.detail_stats->>'isTeamGame' = 'true'
  ),
  seats as (
    select pid, (winner_id = pid) as won from single_seats
    union all
    select pid, (winning_team is not null and team = winning_team) from team_seats where pid is not null
  )
  select p.id, p.name, p.emoji,
         count(*)::bigint as played,
         count(*) filter (where s.won)::bigint as wins,
         round(100.0 * count(*) filter (where s.won) / nullif(count(*), 0), 1) as win_rate
  from seats s join public.players p on p.id = s.pid
  group by p.id, p.name, p.emoji
  order by 5 desc, 6 desc, 4 desc;
$$;

revoke all on function public.online_leaderboard() from public, anon;
grant execute on function public.online_leaderboard() to authenticated;
