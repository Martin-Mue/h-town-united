import { applyLeagueFixtureResult } from "@/lib/leagueFixtureSync";
import { flushLeagueFixtureResultQueue, subscribeLeagueFixtureResultQueueCount } from "@/lib/offlineQueue";
import { useOfflineQueueFlush } from "@/hooks/useOfflineQueueFlush";

/**
 * Mirrors useOfflineMatchResultQueue, but for league_fixtures write-backs (Round 3 backend audit
 * KORREKTUR — see offlineQueue.ts's doc comment for why this queue exists at all): a league
 * result — from a "Spiel starten" live game or League.tsx's manual entry — that couldn't reach
 * Supabase is queued and retried automatically once the connection is back, same durability
 * guarantee the tournament bracket write-back already has.
 * Round 5: now a thin wrapper around useOfflineQueueFlush -- see that file's doc comment for why.
 */
export function useOfflineLeagueFixtureQueue() {
  return useOfflineQueueFlush({
    subscribeCount: subscribeLeagueFixtureResultQueueCount,
    flush: flushLeagueFixtureResultQueue,
    apply: applyLeagueFixtureResult,
    toastMessage: (synced) => ({
      title: `${synced} Liga-Ergebnis${synced === 1 ? "" : "se"} nachgetragen`,
      description: "Offline gespeicherte Liga-Ergebnisse wurden übernommen.",
    }),
  });
}
