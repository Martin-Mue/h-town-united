import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Timer, Info } from "lucide-react";
import { type Match, type RoundRobinMatch } from "@/utils/tournament";
import { type ForecastTournament } from "@/utils/tournamentForecast";
import { useTournamentForecastStats } from "@/hooks/useTournamentForecastStats";
import ForecastCard from "@/components/tournament/ForecastCard";

/** Admin-only: for every currently running tournament, estimates how much longer it'll take —
 *  per remaining round (or, for round-robin, per synthetic board-wave) and in total. Built on the
 *  only historical signal this schema actually has (darts thrown per leg, legs played per match —
 *  see the migration and tournamentForecast.ts for why there's no real wall-clock data to use
 *  instead), so `secondsPerDart` is an admin-tunable input, not a fixed constant.
 *
 *  The stats fetch (modeStats/playerStats/secondsPerDart) and the per-tournament card rendering
 *  now live in useTournamentForecastStats/ForecastCard (Round 3 Rang 2: this forecast engine used
 *  to only be reachable from here — extracted so Tournament.tsx can show the exact same forecast
 *  for the one tournament an organizer actually has open, without duplicating either piece). This
 *  component keeps only what's genuinely admin-wide: the admin_list_active_tournaments fetch. */
const AdminTournamentForecast = () => {
  const [loadingTournaments, setLoadingTournaments] = useState(true);
  const [tournaments, setTournaments] = useState<ForecastTournament[]>([]);
  const { loading: loadingStats, modeStats, playerStats, secondsPerDart, setSecondsPerDart } = useTournamentForecastStats();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("admin_list_active_tournaments");
      if (cancelled) return;
      if (data) {
        setTournaments(
          (data as unknown as Array<Record<string, unknown>>).map((row) => ({
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
      setLoadingTournaments(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loadingTournaments || loadingStats) {
    return (
      <div role="status" aria-label="Lädt …" className="py-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="gradient-card border border-border shadow-elevation-sm rounded-xl p-4">
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

      {tournaments.length === 0 && (
        <div className="gradient-card border border-border shadow-elevation-sm rounded-xl p-8 text-center text-sm text-muted-foreground">
          Aktuell läuft kein Turnier.
        </div>
      )}

      {tournaments.map((tournament) => (
        <ForecastCard
          key={tournament.id}
          tournament={tournament}
          secondsPerDart={secondsPerDart}
          modeStats={modeStats}
          playerStats={playerStats}
        />
      ))}

      <div className="gradient-card border border-border shadow-elevation-sm rounded-xl p-4 flex gap-2 text-[11px] text-muted-foreground">
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
