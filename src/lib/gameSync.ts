import type { GameState } from "@/types/game";
import type { Json } from "@/integrations/supabase/types";
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
export async function saveGameRecord(
  game: GameState,
  userId: string | undefined,
  pendingGameId: string,
  tournamentLink?: { tournamentId: string; matchId: string }
): Promise<void> {
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

  // Trim + case-insensitive: a name typed slightly differently from the stored club-player
  // record (extra space, different casing) must not silently drop the player_id link — that
  // would exclude the game from that player's stats/Elo without any visible error.
  const normalizeName = (s: string) => s.trim().toLowerCase();
  const findDbPlayer = (name: string) => allDbPlayers?.find((p) => normalizeName(p.name) === normalizeName(name));

  // Elo snapshot: every human participant's pre-game rating, captured once up front so a
  // multiplayer game's deltas are all computed against the SAME starting ratings regardless
  // of which player's DB row happens to get updated first below. Team games are excluded —
  // see computeEloDeltas.
  //
  // Ranked by legsWon (the real signal across multi-leg matches) first, then a same-leg
  // tiebreak for whoever's still tied — which in practice is almost everyone whenever
  // bestOfLegs is 1, since every non-winner then sits at legsWon=0 with nothing else to go on.
  // X01 tiebreaks by how close to zero they got (currentLeg.remaining); Cricket has no
  // "remaining" so uses points instead (higher = better, hence the negation to sort ascending
  // like the X01 case). Bots and unmatched guest names are filtered out BEFORE ranking, not
  // just before scoring — a human placing behind a bot still ranks #1 among the humans, since
  // Elo only ever measures human-vs-human standing, same as the old isWinner-only model did.
  const eloTiebreak = (i: number) =>
    game.mode === "cricket" ? -(game.cricket?.[i]?.points ?? 0) : (game.currentLeg.remaining[i] ?? Infinity);
  const eloCandidates: { i: number; id: string; rating: number }[] = [];
  if (!game.teams) {
    for (let i = 0; i < n; i++) {
      if (game.players[i].isBot) continue;
      const match = findDbPlayer(game.players[i].name);
      if (!match) continue;
      eloCandidates.push({ i, id: match.id, rating: Number(match.elo_rating) || 1000 });
    }
  }
  eloCandidates.sort((a, b) => game.legsWon[b.i] - game.legsWon[a.i] || eloTiebreak(a.i) - eloTiebreak(b.i));
  const eloParticipants: EloParticipant[] = [];
  let eloRank = 1;
  eloCandidates.forEach((c, k) => {
    if (k > 0) {
      const prev = eloCandidates[k - 1];
      const tied = game.legsWon[prev.i] === game.legsWon[c.i] && eloTiebreak(prev.i) === eloTiebreak(c.i);
      if (!tied) eloRank = k + 1;
    }
    eloParticipants.push({ id: c.id, rating: c.rating, rank: eloRank });
  });
  const eloDeltas = computeEloDeltas(eloParticipants);
  const p1Match = findDbPlayer(game.players[top1].name);
  const p2Match = top2 !== undefined ? findDbPlayer(game.players[top2].name) : undefined;
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
    const playerMatch = findDbPlayer(game.players[idx].name);
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

  const gameInsertPayload = {
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
    detail_stats: { players: game.players.map((_, i) => detailFor(i)) } as unknown as Json,
    tournament_id: tournamentLink?.tournamentId ?? null,
    ...(tournamentLink ? { match_id: tournamentLink.matchId } : {}),
  };
  // Idempotency check: `pendingGameId` is the same client-generated id across retries
  // specifically so a replay after a lost network ack doesn't create a duplicate game. But a
  // plain INSERT still fails with a duplicate-key error on that replay if the FIRST attempt's
  // insert actually committed server-side and only the response was lost — the caller then
  // queues an unwinnable retry that fails identically forever, silently never running the
  // game_legs insert or the player-stat updates below (they never got a chance to run on the
  // first attempt either, since the client-side throw happened right after the insert call).
  // Fix: check whether the row already exists before inserting, and skip straight to
  // legs/stats (which — in exactly this failure mode — never ran) instead of re-inserting.
  const { data: existingGame, error: existingGameErr } = await supabase.from("games").select("id").eq("id", pendingGameId).maybeSingle();
  // If THIS check fails, the row's primary key still stops an actual double-insert (pendingGameId
  // is the same id either way) — but rather than let that surface as an opaque duplicate-key
  // error with no idea why, fail fast and clearly here so a retry gets a real shot at the SELECT
  // succeeding instead of repeating the same doomed insert-then-conflict cycle.
  if (existingGameErr) throw existingGameErr;
  let insertedGameId: string | null = existingGame?.id ?? null;

  if (!insertedGameId) {
    let { data: insertedGame, error: insertGameErr } = await supabase.from("games").insert(gameInsertPayload).select("id").single();
    // If a given environment hasn't had the `match_id` migration applied yet, PostgREST rejects
    // the whole insert with a schema-cache error — retry once without that field rather than
    // losing the entire game (and silently skipping the tournament bracket write-back below).
    if (insertGameErr && tournamentLink && (insertGameErr.code === "42703" || String(insertGameErr.message || "").includes("match_id"))) {
      const { match_id, ...fallback } = gameInsertPayload;
      ({ data: insertedGame, error: insertGameErr } = await supabase.from("games").insert(fallback).select("id").single());
    }
    if (insertGameErr) throw insertGameErr;
    insertedGameId = insertedGame?.id ?? null;
  }

  // Same reasoning for game_legs: only insert if none exist yet for this game. If they do,
  // this is (at earliest) a retry that got past the legs step before failing — the player-stat
  // updates below are a read-modify-write (increments games_played/average/elo in place, not an
  // upsert), so re-running them on a retry would double-count that game. Skipping both together
  // when legs already exist favors "possibly miss one update" over "silently double-apply it" —
  // the safer failure mode of the two.
  let legsAlreadyExisted = false;
  if (insertedGameId) {
    const { count } = await supabase.from("game_legs").select("id", { count: "exact", head: true }).eq("game_id", insertedGameId);
    legsAlreadyExisted = !!count && count > 0;
    if (!legsAlreadyExisted) {
      const legRows = allLegs.flatMap((leg) =>
        game.players.map((p, i) => ({
          game_id: insertedGameId,
          user_id: userId,
          leg_number: leg.legNumber,
          player_index: i,
          player_name: p.name,
          player_id: findDbPlayer(p.name)?.id || null,
          starting_score: effectiveStartScore(game.startScore, game.players, i, game.teams),
          throws: (leg.throws[i] ?? []) as unknown as Json,
          won: leg.winnerIndex === teamIndexFor(game.teams, i),
        }))
      );
      if (legRows.length > 0) {
        const { error: legsErr } = await supabase.from("game_legs").insert(legRows);
        if (legsErr) throw legsErr;
      }
    }
  }
  if (legsAlreadyExisted) return;

  for (let i = 0; i < n; i++) {
    const match = findDbPlayer(game.players[i].name);
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
