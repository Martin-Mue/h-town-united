import { recordMatchResult } from "@/lib/tournamentMatchSync";
import { flushMatchResultQueue, subscribeMatchResultQueueCount } from "@/lib/offlineQueue";
import { useOfflineQueueFlush } from "@/hooks/useOfflineQueueFlush";

/**
 * Mirrors useOfflineGameQueue, but for tournament bracket write-backs: a "Spiel starten" live
 * game's result that couldn't reach the tournament (offline, or a transient request failure)
 * is queued and retried automatically once the connection is back — same durability guarantee
 * the game save itself already has, so a flaky connection never means "go re-enter it by hand".
 * Round 5: now a thin wrapper around useOfflineQueueFlush -- see that file's doc comment for why.
 */
export function useOfflineMatchResultQueue() {
  return useOfflineQueueFlush({
    subscribeCount: subscribeMatchResultQueueCount,
    flush: flushMatchResultQueue,
    apply: recordMatchResult,
    toastMessage: (synced) => ({
      title: `${synced} Turnierergebnis${synced === 1 ? "" : "se"} nachgetragen`,
      description: "Offline gespeicherte Match-Ergebnisse wurden in den Turnierbaum übernommen.",
    }),
  });
}
