import { supabase } from "@/integrations/supabase/client";

/** Anonymous usage statistics (see 20261031150000_usage_stats.sql): which areas of the app get used
 *  and how many members are active. No third party, no names, no device id - the server stores only
 *  per-club counters and a weekly-salted hash that cannot be linked across weeks. Every member can
 *  switch it off in the settings; nothing is sent while it is off. Failures are swallowed: measuring
 *  must never get in the way of the app. */
const OPT_OUT_KEY = "dartspot-usage-stats";

export const usageTrackingEnabled = (): boolean => {
  try {
    return typeof window === "undefined" || window.localStorage.getItem(OPT_OUT_KEY) !== "off";
  } catch {
    return true;
  }
};

export const setUsageTrackingEnabled = (on: boolean): void => {
  try {
    window.localStorage.setItem(OPT_OUT_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable: the choice just is not remembered */
  }
};

/** Same feature at most every `MIN_GAP_MS`, so a re-rendering component cannot flood the counter. */
const MIN_GAP_MS = 4000;
const lastSent = new Map<string, number>();

/** Count one use of a feature. `feature` is a short lowercase key like `page:game` or `camera_on`. */
export function trackUsage(feature: string): void {
  if (!usageTrackingEnabled()) return;
  const now = Date.now();
  const previous = lastSent.get(feature);
  if (previous !== undefined && now - previous < MIN_GAP_MS) return;
  lastSent.set(feature, now);
  void Promise.resolve(supabase.rpc("track_usage", { _feature: feature })).catch(() => undefined);
}
