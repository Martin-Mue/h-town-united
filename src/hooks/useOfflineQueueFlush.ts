import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface UseOfflineQueueFlushOptions<TApply extends (...args: never[]) => Promise<unknown>> {
  subscribeCount: (cb: (count: number) => void) => () => void;
  flush: (apply: TApply) => Promise<{ synced: number; failed?: number }>;
  apply: TApply;
  /** Builds the "N synced" toast copy for a completed flush. Only called when synced > 0. */
  toastMessage: (synced: number) => { title: string; description: string };
}

/**
 * Round 5: shared implementation behind useOfflineGameQueue / useOfflineMatchResultQueue /
 * useOfflineBracketActionQueue / useOfflineLeagueFixtureQueue -- all four used to carry an
 * identical copy-pasted body (subscribe to the pending count, flush once on mount, flush again on
 * "online", track a syncing flag, toast on success) that differed only in which queue they drain,
 * which replay function they call, and what the success toast says. One implementation now, so a
 * change to the actual flush *behavior* (e.g. a retry backoff, or draining while backgrounded)
 * only needs to happen once instead of being copied into four files by hand.
 *
 * The two effects are intentionally split exactly as the original four were: the count
 * subscription doesn't depend on anything that changes across renders (all callers pass a stable,
 * module-level function reference), and the flush-on-mount-and-online effect deliberately runs
 * only once (equivalent to the original `[]` deps + eslint-disable in each of the four hooks) --
 * this is a "drain on mount / reconnect" effect, not one that should re-fire if `apply` were ever
 * given a fresh closure identity by some future caller.
 */
export function useOfflineQueueFlush<TApply extends (...args: never[]) => Promise<unknown>>({
  subscribeCount,
  flush,
  apply,
  toastMessage,
}: UseOfflineQueueFlushOptions<TApply>) {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = subscribeCount(setPendingCount);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const run = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      setSyncing(true);
      try {
        const { synced } = await flush(apply);
        if (synced > 0) toast(toastMessage(synced));
      } finally {
        setSyncing(false);
      }
    };
    run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { pendingCount, syncing };
}
