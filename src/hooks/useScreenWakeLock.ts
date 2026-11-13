import { useEffect } from "react";

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

/**
 * Keeps the screen from dimming or locking while `active` (a game at the board, the camera watching it).
 *
 * The browser drops the lock whenever the page goes to the background, so it is asked for again each time the
 * page comes back. Browsers without the API (older Safari, Firefox) simply keep their normal behaviour.
 */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    const wakeLock = (navigator as Navigator & { wakeLock: { request: (type: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
    let sentinel: WakeLockSentinelLike | null = null;
    let stopped = false;

    const acquire = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const next = await wakeLock.request("screen");
        if (stopped) void next.release().catch(() => undefined);
        else sentinel = next;
      } catch {
        // refused (battery saver, no user gesture yet): the screen just behaves as usual
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
