import { saveGameRecord } from "@/lib/gameSync";
import { flushGameSaveQueue, subscribeQueueCount } from "@/lib/offlineQueue";
import { useOfflineQueueFlush } from "@/hooks/useOfflineQueueFlush";

/**
 * Keeps the offline game-save queue draining in the background: flushes once on mount
 * (covers "app was closed offline, reopened with wifi back"), again whenever the browser
 * regains connectivity, and exposes the pending count for a small header indicator.
 * Round 5: now a thin wrapper around useOfflineQueueFlush -- see that file's doc comment for why.
 */
export function useOfflineGameQueue() {
  return useOfflineQueueFlush({
    subscribeCount: subscribeQueueCount,
    flush: flushGameSaveQueue,
    apply: saveGameRecord,
    toastMessage: (synced) => ({
      title: `${synced} Spiel${synced === 1 ? "" : "e"} synchronisiert`,
      description: "Offline gespeicherte Ergebnisse wurden nachgetragen.",
    }),
  });
}
