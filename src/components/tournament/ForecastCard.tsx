import { useMemo } from "react";
import { Trophy } from "lucide-react";
import { hasStarted } from "@/utils/tournament";
import {
  forecastTournament,
  formatDuration,
  formatEta,
  type ForecastTournament,
  type ModeStatsIndex,
  type PlayerStatsIndex,
} from "@/utils/tournamentForecast";

/**
 * One tournament's ETA forecast — the per-tournament card originally inline in
 * AdminTournamentForecast.tsx, extracted (Round 3 Rang 2) so the exact same rendering serves both
 * the admin-wide "every active tournament" list and a single-tournament panel on the tournament
 * page itself, instead of the forecast engine only ever being reachable from Admin.
 */
const ForecastCard = ({
  tournament,
  secondsPerDart,
  modeStats,
  playerStats,
}: {
  tournament: ForecastTournament;
  secondsPerDart: number;
  modeStats: ModeStatsIndex;
  playerStats: PlayerStatsIndex;
}) => {
  const started = hasStarted({ mode: tournament.mode, bracket: tournament.bracket });
  const forecast = useMemo(
    () => forecastTournament(tournament, secondsPerDart, modeStats, playerStats),
    [tournament, secondsPerDart, modeStats, playerStats]
  );

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
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
  );
};

export default ForecastCard;
