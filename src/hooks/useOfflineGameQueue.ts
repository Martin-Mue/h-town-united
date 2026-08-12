import { useEffect, useState } from "react";
import { saveGameRecord } from "@/lib/gameSync";
import { flushGameSaveQueue, subscribeQueueCount } from "@/lib/offlineQueue";
import { useToast } from "@/hooks/use-toast";

/**
 * Keeps the offline game-save queue draining in the background: flushes once on mount
 * (covers "app was closed offline, reopened with wifi back"), again whenever the browser
 * regains connectivity, and exposes the pending count for a small header indicator.
 */
export function useOfflineGameQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = subscribeQueueCount(setPendingCount);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const flush = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      setSyncing(true);
      try {
        const { synced } = await flushGameSaveQueue(saveGameRecord);
        if (synced > 0) {
          toast({ title: `${synced} Spiel${synced === 1 ? "" : "e"} synchronisiert`, description: "Offline gespeicherte Ergebnisse wurden nachgetragen." });
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
