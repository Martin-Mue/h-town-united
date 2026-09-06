import { supabase } from "@/integrations/supabase/client";

export interface LeagueFixtureResultInput {
  winnerId: string | null;
  player1LegsWon: number;
  player2LegsWon: number;
  /** Stamps the fixture with the game it came from — Game.tsx's live-play path only; League.tsx's
   *  manual entry has no game row to reference. */
  gameId?: string;
  /** Game.tsx's write-back only ever applies to a still-`pending` fixture, so a duplicate replay
   *  (e.g. the offline queue retrying after the direct write actually succeeded server-side but
   *  the response was lost) can't clobber a result that already landed. League.tsx's manual entry
   *  has no such guard — an admin correcting an already-`finished` fixture by hand is legitimate. */
  guardPending: boolean;
}

/**
 * The one place that writes a match/game result into `league_fixtures` — shared by Game.tsx's
 * post-game write-back, League.tsx's manual entry form, and the offline-queue replay for both
 * (see offlineQueue.ts's leagueFixtureResultQueue / Round 3 backend audit KORREKTUR). Previously
 * each of those three call sites had (or would have needed) its own copy of this same `.update()`
 * call; a single shared function means the retry queue replays exactly the write that was
 * attempted, not a second, potentially-drifted reimplementation of it.
 */
export async function applyLeagueFixtureResult(fixtureId: string, result: LeagueFixtureResultInput): Promise<void> {
  let query = supabase
    .from("league_fixtures")
    .update({
      status: "finished",
      winner_id: result.winnerId,
      player1_legs_won: result.player1LegsWon,
      player2_legs_won: result.player2LegsWon,
      played_at: new Date().toISOString(),
      ...(result.gameId ? { game_id: result.gameId } : {}),
    })
    .eq("id", fixtureId);
  if (result.guardPending) query = query.eq("status", "pending");
  const { error } = await query;
  if (error) throw error;
}
