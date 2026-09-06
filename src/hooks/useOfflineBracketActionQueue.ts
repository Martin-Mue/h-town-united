import { useEffect, useState } from "react";
import { applyBracketAction } from "@/lib/tournamentMatchSync";
import { flushBracketActionQueue, subscribeBracketActionQueueCount } from "@/lib/offlineQueue";
import { useToast } from "@/hooks/use-toast";

/**
 * Mirrors useOfflineMatchResultQueue, but for manual bracket-scoring taps made directly in the
 * Tournament.tsx admin UI (declare winner, +1 leg, reset a match) — the actions a "Sieger
 * erklären"-Tap on a board tablet actually is. Those had no offline durability at all before
 * this: a failed write just showed an error toast and the tap was gone. Now it's queued and
 * replayed automatically once the connection is back, through the exact same applyBracketAction
 * used for the immediate online path — so a queued tap is always resolved against whatever the
 * bracket looks like by the time it replays, not against a stale snapshot from tap time.
 */
export function useOfflineBracketActionQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = subscribeBracketActionQueueCount(setPendingCount);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const flush = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      setSyncing(true);
      try {
        const { synced } = await flushBracketActionQueue(applyBracketAction);
        if (synced > 0) {
          toast({ title: `${synced} Turnier-Aktion${synced === 1 ? "" : "en"} nachgetragen`, description: "Offline gespeicherte Spielstand-Änderungen wurden in den Turnierbaum übernommen." });
        }
      } finally {
        setSyncing(false);
      }
    };
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { pendingCount, syncing };
}
