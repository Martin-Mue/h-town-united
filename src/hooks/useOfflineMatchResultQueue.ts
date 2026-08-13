import { useEffect, useState } from "react";
import { recordMatchResult } from "@/lib/tournamentMatchSync";
import { flushMatchResultQueue, subscribeMatchResultQueueCount } from "@/lib/offlineQueue";
import { useToast } from "@/hooks/use-toast";

/**
 * Mirrors useOfflineGameQueue, but for tournament bracket write-backs: a "Spiel starten" live
 * game's result that couldn't reach the tournament (offline, or a transient request failure)
 * is queued and retried automatically once the connection is back — same durability guarantee
 * the game save itself already has, so a flaky connection never means "go re-enter it by hand".
 */
export function useOfflineMatchResultQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = subscribeMatchResultQueueCount(setPendingCount);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const flush = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      setSyncing(true);
      try {
        const { synced } = await flushMatchResultQueue(recordMatchResult);
        if (synced > 0) {
          toast({ title: `${synced} Turnierergebnis${synced === 1 ? "" : "se"} nachgetragen`, description: "Offline gespeicherte Match-Ergebnisse wurden in den Turnierbaum übernommen." });
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
