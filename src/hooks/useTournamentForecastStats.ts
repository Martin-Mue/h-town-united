import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildModeStatsIndex,
  buildPlayerStatsIndex,
  type ModeStatsIndex,
  type PlayerStatsIndex,
} from "@/utils/tournamentForecast";

const SECONDS_PER_DART_PREF_KEY = "dart-admin-forecast-seconds-per-dart";
const DEFAULT_SECONDS_PER_DART = 9;

/**
 * The club-wide historical stats behind the tournament ETA forecast (see tournamentForecast.ts) —
 * split out of AdminTournamentForecast.tsx (Round 3 Rang 2: "Forecast-Engine fertig, aber in Admin
 * vergraben") so the same admin_tournament_forecast_* RPCs and the admin-tunable seconds-per-dart
 * preference can be shared between the admin-wide forecast tab (every active tournament) and a
 * single-tournament forecast panel on the tournament page itself, instead of only existing in the
 * former. Both RPCs are admin-only SECURITY DEFINER functions (see their migration) — this hook is
 * only meaningful for an admin caller; a non-admin caller gets empty stats back (the RPC calls
 * reject with "Not authorized", swallowed the same way a genuinely-empty history is).
 *
 * `enabled` (default true) skips the RPC fetch entirely — for a caller like Tournament.tsx that
 * must call this hook unconditionally (rules of hooks) but only actually wants the data once it
 * knows the viewer is an admin, so a non-admin organizer's page doesn't fire two RPC calls that
 * are guaranteed to reject.
 */
export function useTournamentForecastStats(enabled: boolean = true) {
  const [loading, setLoading] = useState(enabled);
  const [modeStats, setModeStats] = useState<ModeStatsIndex>({ legsPerMatch: new Map(), dartsPerLeg: new Map() });
  const [playerStats, setPlayerStats] = useState<PlayerStatsIndex>(new Map());
  const [secondsPerDart, setSecondsPerDart] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SECONDS_PER_DART;
    const raw = window.localStorage.getItem(SECONDS_PER_DART_PREF_KEY);
    const n = raw ? parseFloat(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_SECONDS_PER_DART;
  });

  useEffect(() => {
    window.localStorage.setItem(SECONDS_PER_DART_PREF_KEY, String(secondsPerDart));
  }, [secondsPerDart]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [modeRes, playerRes] = await Promise.all([
        supabase.rpc("admin_tournament_forecast_mode_stats"),
        supabase.rpc("admin_tournament_forecast_player_stats"),
      ]);
      if (cancelled) return;
      if (modeRes.data) setModeStats(buildModeStatsIndex(modeRes.data));
      if (playerRes.data) setPlayerStats(buildPlayerStatsIndex(playerRes.data));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  return { loading, modeStats, playerStats, secondsPerDart, setSecondsPerDart };
}
