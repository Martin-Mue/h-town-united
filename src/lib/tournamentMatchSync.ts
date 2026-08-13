import { supabase } from "@/integrations/supabase/client";
import {
  type Match,
  type RoundRobinMatch,
  type LiveSnapshot,
  recomputeBracket,
  assignScorekeepers,
  bracketChampion,
  calcStandings,
  newlyPlayableMatches,
} from "@/utils/tournament";

export interface MatchResultInput {
  winnerName: string;
  score1?: number;
  score2?: number;
}

/**
 * "Your match is up next" push for whoever just became playable as a result of this write-back
 * — mirrors Tournament.tsx's `notifyMatchReady`, which only fires for edits made through the
 * admin UI. A live game finishing (this module's whole reason to exist) advances the bracket
 * exactly the same way and deserves the same notification. Best-effort: never blocks or
 * rethrows, matching the "spectator sugar, not authoritative" stance of the rest of this file.
 */
async function notifyMatchesReady(matches: Match[]): Promise<void> {
  try {
    const names = Array.from(new Set(matches.flatMap((m) => [m.player1, m.player2]).filter((n): n is string => !!n && n !== "BYE")));
    if (names.length === 0) return;
    const { data: players } = await supabase.from("players").select("user_id, name").in("name", names);
    for (const m of matches) {
      const userIds = [m.player1, m.player2]
        .map((name) => players?.find((p) => p.name === name)?.user_id)
        .filter((id): id is string => !!id);
      if (userIds.length === 0) continue;
      const boardLabel = m.board ? ` (Board ${m.board})` : "";
      await supabase.functions.invoke("send-push", {
        body: { userIds, title: "Dein Match ist bereit", body: `${m.player1} vs. ${m.player2}${boardLabel} — ihr seid dran.`, url: "/tournament" },
      });
    }
  } catch (err) {
    console.error("notifyMatchesReady failed", err);
  }
}

/**
 * Best-effort "what's the score right now" push for the public live view — spectator sugar,
 * never authoritative. Every failure is swallowed: this must never interrupt or slow down an
 * in-progress game, and there's no retry queue for it (unlike the final result), since a late
 * live snapshot has no value once the game has moved on.
 */
export async function pushLiveSnapshot(tournamentId: string, matchId: string, snapshot: LiveSnapshot): Promise<void> {
  try {
    const { data: tournament, error } = await supabase.from("tournaments").select("bracket").eq("id", tournamentId).single();
    if (error || !tournament) return;
    const bracket = ((tournament.bracket as unknown as (Match | RoundRobinMatch)[]) || []).map((m) =>
      m.id === matchId ? { ...m, live: snapshot } : m
    );
    await supabase.from("tournaments").update({ bracket: bracket as any }).eq("id", tournamentId);
  } catch {
    // best-effort — see doc comment
  }
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
      m.id === matchId ? { ...m, winner: result.winnerName, played: true, live: undefined } : m
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
    m.id === matchId ? { ...m, winner: result.winnerName, score1: result.score1, score2: result.score2, live: undefined } : m
  );
  const activePlayers = (tournament.players as unknown as string[]) || [];
  const recomputed = recomputeBracket(raw, activePlayers);
  const withKeepers = assignScorekeepers(recomputed, activePlayers, {
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

  void notifyMatchesReady(newlyPlayableMatches((tournament.bracket as unknown as Match[]) || [], withKeepers));
}
