import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Timer, Info, Trophy } from "lucide-react";
import { hasStarted, type Match, type RoundRobinMatch } from "@/utils/tournament";
import {
  buildModeStatsIndex,
  buildPlayerStatsIndex,
  forecastTournament,
  formatDuration,
  formatEta,
  type ForecastTournament,
  type ModeStatsIndex,
  type PlayerStatsIndex,
} from "@/utils/tournamentForecast";

const SECONDS_PER_DART_PREF_KEY = "dart-admin-forecast-seconds-per-dart";
const DEFAULT_SECONDS_PER_DART = 9;

/** Admin-only: for every currently running tournament, estimates how much longer it'll take —
 *  per remaining round (or, for round-robin, per synthetic board-wave) and in total. Built on the
 *  only historical signal this schema actually has (darts thrown per leg, legs played per match —
 *  see the migration and tournamentForecast.ts for why there's no real wall-clock data to use
 *  instead), so `secondsPerDart` is an admin-tunable input, not a fixed constant. */
const AdminTournamentForecast = () => {
  const [loading, setLoading] = useState(true);
  const [tournaments, setTournaments] = useState<ForecastTournament[]>([]);
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
    let cancelled = false;
    (async () => {
      const [tRes, modeRes, playerRes] = await Promise.all([
        supabase.rpc("admin_list_active_tournaments"),
        supabase.rpc("admin_tournament_forecast_mode_stats"),
        supabase.rpc("admin_tournament_forecast_player_stats"),
      ]);
      if (cancelled) return;
      if (tRes.data) {
        setTournaments(
          (tRes.data as unknown as Array<Record<string, unknown>>).map((row) => ({
            id: row.id as string,
            name: row.name as string,
            mode: row.mode as string,
            players: (row.players as unknown as string[]) || [],
            bracket: (row.bracket as unknown as Match[] | RoundRobinMatch[]) || [],
            game_mode: row.game_mode as string | undefined,
            best_of_legs: row.best_of_legs as number | undefined,
            round_configs: (row.round_configs as unknown as { mode: string; bestOf: number }[]) || [],
            boards: row.boards as number | undefined,
          }))
        );
      }
      if (modeRes.data) setModeStats(buildModeStatsIndex(modeRes.data));
      if (playerRes.data) setPlayerStats(buildPlayerStatsIndex(playerRes.data));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const forecasts = useMemo(
    () =>
      tournaments.map((t) => ({
        tournament: t,
        started: hasStarted({ mode: t.mode, bracket: t.bracket }),
        forecast: forecastTournament(t, secondsPerDart, modeStats, playerStats),
      })),
    [tournaments, secondsPerDart, modeStats, playerStats]
  );

  if (loading) {
    return (
      <div role="status" aria-label="Lädt …" className="py-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-display text-sm uppercase text-muted-foreground flex items-center gap-2">
            <Timer className="w-4 h-4" /> Zeit-Tempo
          </h3>
          <div className="flex items-center gap-2">
            <label htmlFor="seconds-per-dart" className="text-xs text-muted-foreground">Ø Sekunden pro Wurf</label>
            <input
              id="seconds-per-dart"
              type="number"
              min={1}
              step={0.5}
              value={secondsPerDart}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v > 0) setSecondsPerDart(v);
              }}
              className="w-20 rounded-lg bg-background border border-border px-2 py-1 text-sm text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Nur dieser Wert ist eine Annahme — alles andere (Darts pro Leg, Legs pro Match) stammt aus echten,
          bereits gespielten Spielen dieses Vereins. Höher stellen, wenn eure Partien in der Praxis eher gemütlich laufen.
        </p>
      </div>

      {forecasts.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
          Aktuell läuft kein Turnier.
        </div>
      )}

      {forecasts.map(({ tournament, started, forecast }) => (
        <div key={tournament.id} className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <h3 className="font-display uppercase text-sm flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" /> {tournament.name}
            </h3>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {tournament.mode === "round-robin" ? "Round Robin" : "KO"} · {tournament.players.length} Spieler · {tournament.boards || 2} Boards
            </span>
          </div>

          {!started ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">Noch nicht gestartet — noch keine Prognose möglich.</p>
          ) : forecast.rounds.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">Alle Partien entschieden — im Grunde fertig.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20">
                    <tr className="text-left text-[10px] uppercase text-muted-foreground">
                      <th className="px-4 py-2">Runde</th>
                      <th className="px-4 py-2 text-right">Spiele</th>
                      <th className="px-4 py-2 text-right">Wellen</th>
                      <th className="px-4 py-2 text-right">Dauer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.rounds.map((r) => (
                      <tr key={r.round} className="border-t border-border">
                        <td className="px-4 py-2">
                          {r.label}
                          {r.mode === "Extern" && <span className="ml-2 text-[10px] text-muted-foreground uppercase">extern gespielt</span>}
                        </td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{r.matchCount}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{r.waves}</td>
                        <td className="px-4 py-2 text-right">
                          {r.estimatedSeconds != null ? formatDuration(r.estimatedSeconds) : <span className="text-muted-foreground">–</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 border-t border-border bg-muted/10 flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs text-muted-foreground">Turnier gesamt</span>
                {forecast.totalEstimatedSeconds != null ? (
                  <span className="font-display text-lg text-primary">
                    noch ca. {formatDuration(forecast.totalEstimatedSeconds)} · fertig gegen {formatEta(forecast.totalEstimatedSeconds)}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    mindestens {formatDuration(forecast.rounds.reduce((s, r) => s + (r.estimatedSeconds ?? 0), 0))} — enthält extern gespielte Runden ohne Schätzung
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      ))}

      <div className="bg-card border border-border rounded-xl p-4 flex gap-2 text-[11px] text-muted-foreground">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <p>
          Es wird nirgends eine echte Uhrzeit für Leg- oder Match-Beginn/-Ende erfasst — die Schätzung beruht auf
          tatsächlich geworfenen Darts pro Leg und tatsächlich gespielten Legs pro Match (clubweit, aus echten
          Spielen), mit einer bekannten Spieler-Paarung sobald sie feststeht. Sie wird also mit mehr gespielten
          Spielen von selbst genauer — kein Grund, das für ein bereits sehr aktives Turnier zu erwarten.
        </p>
      </div>
    </div>
  );
};

export default AdminTournamentForecast;
