import { useEffect, useState } from "react";
import { applyLeagueFixtureResult } from "@/lib/leagueFixtureSync";
import { flushLeagueFixtureResultQueue, subscribeLeagueFixtureResultQueueCount } from "@/lib/offlineQueue";
import { useToast } from "@/hooks/use-toast";

/**
 * Mirrors useOfflineMatchResultQueue, but for league_fixtures write-backs (Round 3 backend audit
 * KORREKTUR — see offlineQueue.ts's doc comment for why this queue exists at all): a league
 * result — from a "Spiel starten" live game or League.tsx's manual entry — that couldn't reach
 * Supabase is queued and retried automatically once the connection is back, same durability
 * guarantee the tournament bracket write-back already has.
 */
export function useOfflineLeagueFixtureQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = subscribeLeagueFixtureResultQueueCount(setPendingCount);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const flush = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      setSyncing(true);
      try {
        const { synced } = await flushLeagueFixtureResultQueue(applyLeagueFixtureResult);
        if (synced > 0) {
          toast({ title: `${synced} Liga-Ergebnis${synced === 1 ? "" : "se"} nachgetragen`, description: "Offline gespeicherte Liga-Ergebnisse wurden übernommen." });
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
