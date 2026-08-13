import { supabase } from "@/integrations/supabase/client";
import {
  type Match,
  type RoundRobinMatch,
  recomputeBracket,
  assignScorekeepers,
  bracketChampion,
  calcStandings,
} from "@/utils/tournament";

export interface MatchResultInput {
  winnerName: string;
  score1?: number;
  score2?: number;
}

/**
 * Writes a finished live game's result back into a tournament's bracket. Always re-fetches
 * the tournament row fresh from Supabase first, rather than trusting any caller-held state —
 * multiple boards/devices can finish different matches of the same tournament at roughly the
 * same time, and a stale read-modify-write would silently drop whichever update lands second.
 */
export async function recordMatchResult(tournamentId: string, matchId: string, result: MatchResultInput): Promise<void> {
  const { data: tournament, error } = await supabase
    .from("tournaments")
    .select("id, mode, bracket, players, boards, round_configs")
    .eq("id", tournamentId)
    .single();
  if (error) throw error;
  if (!tournament) throw new Error("Tournament not found");

  if (tournament.mode === "round-robin") {
    const bracket = ((tournament.bracket as unknown as RoundRobinMatch[]) || []).map((m) =>
      m.id === matchId ? { ...m, winner: result.winnerName, played: true } : m
    );
    const allPlayed = bracket.length > 0 && bracket.every((m) => m.played);
    const champion = allPlayed ? calcStandings(bracket)[0]?.name || null : null;
    const { error: updErr } = await supabase.from("tournaments").update({
      bracket: bracket as any,
      champion,
      status: champion ? "finished" : "active",
    }).eq("id", tournamentId);
    if (updErr) throw updErr;
    return;
  }

  const raw = ((tournament.bracket as unknown as Match[]) || []).map((m) =>
    m.id === matchId ? { ...m, winner: result.winnerName, score1: result.score1, score2: result.score2 } : m
  );
  const recomputed = recomputeBracket(raw);
  const withKeepers = assignScorekeepers(recomputed, (tournament.players as unknown as string[]) || [], {
    boards: tournament.boards || 2,
    keepExisting: true,
  });
  const champion = bracketChampion(withKeepers);
  const { error: updErr } = await supabase.from("tournaments").update({
    bracket: withKeepers as any,
    champion,
    status: champion ? "finished" : "active",
  }).eq("id", tournamentId);
  if (updErr) throw updErr;
}
