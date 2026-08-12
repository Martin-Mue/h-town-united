import type { GameState } from "@/types/game";
import { supabase } from "@/integrations/supabase/client";
import { teamIndexFor } from "@/utils/teamUtils";
import { effectiveStartScore } from "@/utils/handicap";
import { computeEloDeltas, type EloParticipant } from "@/utils/elo";
import {
  average as calculateAverage,
  highestVisit as getHighest3DartRound,
  computeCheckoutStats,
  combineCheckoutStats,
} from "@/utils/dartStats";

/**
 * Persists a finished match to Supabase: the `games` summary row, every leg's
 * dart-by-dart `game_legs` rows, and each human player's rolled-up career stats.
 * Used both for the immediate save right after a match finishes and for replaying
 * a queued save once the connection comes back (see offlineQueue.ts) — must throw
 * on any failure so the caller can decide to queue/retry rather than silently drop data.
 */
export async function saveGameRecord(game: GameState, userId: string | undefined, pendingGameId: string): Promise<void> {
  const allLegs = [...game.completedLegs, game.currentLeg];
  const n = game.players.length;
  const throwsByPlayer = Array.from({ length: n }, (_, i) => allLegs.flatMap((l) => l.throws[i] ?? []));
  const averages = throwsByPlayer.map(calculateAverage);
  const highs = throwsByPlayer.map(getHighest3DartRound);
  const doubleRates = game.mode === "cricket"
    ? Array(n).fill(0)
    : Array.from({ length: n }, (_, i) =>
        combineCheckoutStats(allLegs.map((leg) => computeCheckoutStats(leg.throws[i] ?? [], effectiveStartScore(game.startScore, game.players, i, game.teams)))).percentage
      );

  const ranking = game.teams
    ? [
        game.players.findIndex((_, i) => teamIndexFor(game.teams, i) === 0),
        game.players.findIndex((_, i) => teamIndexFor(game.teams, i) === 1),
      ]
    : game.players.map((_, i) => i).sort((a, b) => game.legsWon[b] - game.legsWon[a]);
  const [top1, top2] = ranking;

  const { data: allDbPlayers, error: playersErr } = await supabase.from("players").select("id, name, elo_rating");
  if (playersErr) throw playersErr;

  // Elo snapshot: every human participant's pre-game rating, captured once up front so a
  // multiplayer game's deltas are all computed against the SAME starting ratings regardless
  // of which player's DB row happens to get updated first below. Team games are excluded —
  // see computeEloDeltas.
  const eloParticipants: EloParticipant[] = [];
  if (!game.teams) {
    for (let i = 0; i < n; i++) {
      if (game.players[i].isBot) continue;
      const match = allDbPlayers?.find((p) => p.name === game.players[i].name);
      if (!match) continue;
      eloParticipants.push({ id: match.id, rating: Number(match.elo_rating) || 1000, isWinner: game.winnerIndex === i });
    }
  }
  const eloDeltas = computeEloDeltas(eloParticipants);
  const p1Match = allDbPlayers?.find((p) => p.name === game.players[top1].name);
  const p2Match = top2 !== undefined ? allDbPlayers?.find((p) => p.name === game.players[top2].name) : undefined;
  const winnerIdx = game.winnerIndex ?? top1;
  const winnerMatch = winnerIdx === top1 ? p1Match : p2Match;
  const player1Name = game.teams ? game.teams[0].name : game.players[top1].name;
  const player2Name = game.teams ? game.teams[1].name : (top2 !== undefined ? game.players[top2].name : "—");

  const detailFor = (idx: number) => {
    const throws = throwsByPlayer[idx];
    const visits: (typeof throws)[] = [];
    for (let i = 0; i < throws.length; i += 3) visits.push(throws.slice(i, i + 3));
    const trebleless = visits.filter((v) => v.length > 0 && v.every((t) => t.multiplier !== 3)).length;
    const tripleHits: Record<string, number> = {};
    [20, 19, 18, 17, 16].forEach((n2) => {
      tripleHits[`t${n2}`] = throws.filter((t) => t.multiplier === 3 && t.baseValue === n2).length;
    });
    const playerMatch = allDbPlayers?.find((p) => p.name === game.players[idx].name);
    return {
      name: game.players[idx].name,
      player_id: playerMatch?.id || null,
      visits: visits.length,
      trebleless,
      treblelessRate: visits.length ? Math.round((trebleless / visits.length) * 1000) / 10 : 0,
      triples: throws.filter((t) => t.multiplier === 3).length,
      ...tripleHits,
    };
  };

  const { data: insertedGame, error: insertGameErr } = await supabase.from("games").insert({
    id: pendingGameId,
    user_id: userId, mode: game.mode, start_score: game.startScore,
    best_of_legs: game.bestOfLegs,
    player1_name: player1Name, player2_name: player2Name,
    player1_id: p1Match?.id || null, player2_id: p2Match?.id || null,
    player1_legs_won: game.legsWon[top1], player2_legs_won: top2 !== undefined ? game.legsWon[top2] : 0,
    player1_average: averages[top1], player2_average: top2 !== undefined ? averages[top2] : 0,
    player1_highscore: highs[top1], player2_highscore: top2 !== undefined ? highs[top2] : 0,
    player1_double_rate: doubleRates[top1], player2_double_rate: top2 !== undefined ? doubleRates[top2] : 0,
    player1_total_throws: throwsByPlayer[top1].length, player2_total_throws: top2 !== undefined ? throwsByPlayer[top2].length : 0,
    winner_name: game.winnerName!, winner_id: winnerMatch?.id || null,
    detail_stats: { players: game.players.map((_, i) => detailFor(i)) } as any,
  }).select("id").single();
  if (insertGameErr) throw insertGameErr;

  if (insertedGame?.id) {
    const legRows = allLegs.flatMap((leg) =>
      game.players.map((p, i) => ({
        game_id: insertedGame.id,
        user_id: userId,
        leg_number: leg.legNumber,
        player_index: i,
        player_name: p.name,
        player_id: allDbPlayers?.find((dp) => dp.name === p.name)?.id || null,
        starting_score: effectiveStartScore(game.startScore, game.players, i, game.teams),
        throws: leg.throws[i] ?? [],
        won: leg.winnerIndex === teamIndexFor(game.teams, i),
      }))
    );
    if (legRows.length > 0) {
      const { error: legsErr } = await supabase.from("game_legs").insert(legRows as any);
      if (legsErr) throw legsErr;
    }
  }

  for (let i = 0; i < n; i++) {
    const match = allDbPlayers?.find((p) => p.name === game.players[i].name);
    if (match && !game.players[i].isBot) {
      const { data: current, error: curErr } = await supabase.from("players").select("*").eq("id", match.id).single();
      if (curErr) throw curErr;
      if (current) {
        const gp = current.games_played + 1;
        const newAvg = (Number(current.average) * current.games_played + averages[i]) / gp;
        const newDoubleRate = game.mode === "cricket"
          ? Number(current.double_rate) || 0
          : (Number(current.double_rate) * current.games_played + doubleRates[i]) / gp;
        const newElo = Math.round((Number(current.elo_rating) || 1000) + (eloDeltas[match.id] ?? 0));
        const { error: updErr } = await supabase.from("players").update({
          games_played: gp, games_won: current.games_won + (game.winnerIndex === teamIndexFor(game.teams, i) ? 1 : 0),
          average: Math.round(newAvg * 10) / 10, high_score: Math.max(current.high_score, highs[i]),
          double_rate: Math.round(newDoubleRate * 10) / 10,
          elo_rating: newElo,
        }).eq("id", match.id);
        if (updErr) throw updErr;
      }
    }
  }
}
