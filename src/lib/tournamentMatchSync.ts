import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  type Match,
  type RoundRobinMatch,
  type LiveSnapshot,
  recomputeBracket,
  assignScorekeepers,
  bracketChampion,
  calcStandings,
  newlyPlayableMatches,
  resolveMatchUserIds,
  buildMatchReadyPush,
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
      const userIds = resolveMatchUserIds(m, players ?? []);
      if (userIds.length === 0) continue;
      await supabase.functions.invoke("send-push", {
        body: { userIds, ...buildMatchReadyPush(m) },
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
 *
 * Fires every ~1.2s per active linked game (see the caller), so with several boards live at once
 * this hits the same tournament row often. Patches the match's `live` field via a single atomic
 * server-side UPDATE (see the update_match_live_snapshot migration) instead of a client-side
 * SELECT-then-UPDATE — the old read-modify-write had a real window for a concurrent write
 * (another board finishing, an owner's manual edit) to land in between and get silently reverted.
 */
export async function pushLiveSnapshot(tournamentId: string, matchId: string, snapshot: LiveSnapshot): Promise<void> {
  try {
    await supabase.rpc("update_match_live_snapshot", {
      p_tournament_id: tournamentId,
      p_match_id: matchId,
      p_snapshot: snapshot as unknown as Json,
    });
  } catch {
    // best-effort — see doc comment
  }
}

/** How many times to re-fetch and retry recordMatchResult before giving up on a live conflict.
 *  Genuinely contended writes (two boards finishing different matches of the same tournament
 *  within milliseconds of each other) are rare even at a busy club night with several boards
 *  live — this is a defensive bound, not a real hot path, so no backoff between attempts. */
const MAX_CONCURRENT_WRITE_ATTEMPTS = 5;

/**
 * Writes a finished live game's result back into a tournament's bracket. Always re-fetches
 * the tournament row fresh from Supabase first, rather than trusting any caller-held state —
 * multiple boards/devices can finish different matches of the same tournament at roughly the
 * same time.
 *
 * The read-modify-write this replaced had a real race: SELECT, then (bracket recompute takes a
 * moment — recomputeBracket/assignScorekeepers aren't free) UPDATE with whatever was locally
 * computed. If a second board's finish landed in between, its UPDATE would overwrite the bracket
 * with a version computed from the pre-first-write snapshot — silently dropping the first board's
 * result entirely, with no error on either side. recomputeBracket/assignScorekeepers are pure JS
 * with real business logic (bye resolution, round propagation, scorekeeper rotation) — reimplementing
 * that in a SECURITY DEFINER SQL function (the way pushLiveSnapshot's simpler single-field patch
 * does) would mean maintaining the same rules in two languages. Optimistic concurrency instead:
 * the UPDATE is conditioned on `updated_at` still matching what this attempt read (that column is
 * trigger-maintained — see the update_tournaments_updated_at trigger — so it changes on every
 * write, including ones from other clients). If a concurrent write already landed, this attempt's
 * WHERE clause matches zero rows instead of clobbering it; re-fetch (now seeing the other write)
 * and recompute from the up-to-date bracket instead.
 */
export async function recordMatchResult(tournamentId: string, matchId: string, result: MatchResultInput): Promise<void> {
  for (let attempt = 0; attempt < MAX_CONCURRENT_WRITE_ATTEMPTS; attempt++) {
    const { data: tournament, error } = await supabase
      .from("tournaments")
      .select("id, mode, bracket, players, boards, round_configs, updated_at")
      .eq("id", tournamentId)
      .single();
    if (error) throw error;
    if (!tournament) throw new Error("Tournament not found");

    if (tournament.mode === "round-robin") {
      const rrBracket = (tournament.bracket as unknown as RoundRobinMatch[]) || [];
      // Someone else's write already decided this match (two devices finishing the same match
      // close together, or a manual correction landing first) — don't clobber a real result with
      // whatever this call happened to compute. Not an error to retry: the underlying game row is
      // saved regardless (see the caller), only this specific bracket write-back is a no-op.
      if (rrBracket.find((m) => m.id === matchId)?.played) return;
      const bracket = rrBracket.map((m) =>
        m.id === matchId ? { ...m, winner: result.winnerName, played: true, live: undefined } : m
      );
      const allPlayed = bracket.length > 0 && bracket.every((m) => m.played);
      const champion = allPlayed ? calcStandings(bracket)[0]?.name || null : null;
      const { data: updated, error: updErr } = await supabase.from("tournaments").update({
        bracket: bracket as unknown as Json,
        champion,
        status: champion ? "finished" : "active",
      }).eq("id", tournamentId).eq("updated_at", tournament.updated_at).select("id");
      if (updErr) throw updErr;
      if (updated && updated.length > 0) return;
      continue; // lost the race — someone else wrote first; re-fetch and try again
    }

    const koBracket = (tournament.bracket as unknown as Match[]) || [];
    // Same reasoning as the round-robin branch above — already decided by another write, skip
    // rather than overwrite (and never throw here: the caller queues a thrown error for retry,
    // which would just fail identically forever once a match is genuinely already decided).
    if (koBracket.find((m) => m.id === matchId)?.winner) return;
    const raw = koBracket.map((m) =>
      m.id === matchId ? { ...m, winner: result.winnerName, score1: result.score1, score2: result.score2, live: undefined } : m
    );
    const activePlayers = (tournament.players as unknown as string[]) || [];
    const recomputed = recomputeBracket(raw, activePlayers);
    const withKeepers = assignScorekeepers(recomputed, activePlayers, {
      boards: tournament.boards || 2,
      keepExisting: true,
    });
    const champion = bracketChampion(withKeepers);
    const { data: updated, error: updErr } = await supabase.from("tournaments").update({
      bracket: withKeepers as unknown as Json,
      champion,
      status: champion ? "finished" : "active",
    }).eq("id", tournamentId).eq("updated_at", tournament.updated_at).select("id");
    if (updErr) throw updErr;
    if (updated && updated.length > 0) {
      void notifyMatchesReady(newlyPlayableMatches((tournament.bracket as unknown as Match[]) || [], withKeepers));
      return;
    }
    // lost the race — someone else wrote (or manually edited) the tournament between our SELECT
    // and this UPDATE; loop back and recompute from the now-current bracket instead of retrying
    // blindly with stale data.
  }
  throw new Error("recordMatchResult: too many concurrent write conflicts, giving up");
}
