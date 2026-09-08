import { applyBracketAction } from "@/lib/tournamentMatchSync";
import { flushBracketActionQueue, subscribeBracketActionQueueCount } from "@/lib/offlineQueue";
import { useOfflineQueueFlush } from "@/hooks/useOfflineQueueFlush";

/**
 * Mirrors useOfflineMatchResultQueue, but for manual bracket-scoring taps made directly in the
 * Tournament.tsx admin UI (declare winner, +1 leg, reset a match) — the actions a "Sieger
 * erklären"-Tap on a board tablet actually is. Those had no offline durability at all before
 * this: a failed write just showed an error toast and the tap was gone. Now it's queued and
 * replayed automatically once the connection is back, through the exact same applyBracketAction
 * used for the immediate online path — so a queued tap is always resolved against whatever the
 * bracket looks like by the time it replays, not against a stale snapshot from tap time.
 * Round 5: now a thin wrapper around useOfflineQueueFlush -- see that file's doc comment for why.
 */
export function useOfflineBracketActionQueue() {
  return useOfflineQueueFlush({
    subscribeCount: subscribeBracketActionQueueCount,
    flush: flushBracketActionQueue,
    apply: applyBracketAction,
    toastMessage: (synced) => ({
      title: `${synced} Turnier-Aktion${synced === 1 ? "" : "en"} nachgetragen`,
      description: "Offline gespeicherte Spielstand-Änderungen wurden in den Turnierbaum übernommen.",
    }),
  });
}
