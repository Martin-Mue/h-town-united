import { ArrowDown, ArrowUp } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

export interface LeagueStandingsTableRow {
  playerId: string;
  rank: number;
  name: string;
  emoji: string | null;
  played: number;
  won: number;
  legsFor: number;
  legsAgainst: number;
  points: number;
  /** Season league: this place moves up / down a division when the season ends. */
  zone: "promote" | "relegate" | null;
}

/** Compact league table with tabular numbers; scrolls sideways inside its own box on a narrow phone. */
const LeagueStandingsTable = ({ rows }: { rows: LeagueStandingsTableRow[] }) => {
  const { t } = useLanguage();
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[320px] text-sm tabular-nums">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            <th scope="col" className="w-9 py-2 pl-3 text-left font-medium">#</th>
            <th scope="col" className="py-2 text-left font-medium">{t("stats.player")}</th>
            <th scope="col" className="w-9 py-2 text-center font-medium">{t("league.colPlayed")}</th>
            <th scope="col" className="w-9 py-2 text-center font-medium">{t("league.colWon")}</th>
            <th scope="col" className="w-14 py-2 text-center font-medium">{t("league.colLegs")}</th>
            <th scope="col" className="w-12 py-2 pr-3 text-right font-medium">{t("league.colPoints")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.playerId}
              className={`border-b border-border/60 last:border-b-0 ${row.zone === "promote" ? "bg-secondary/5" : row.zone === "relegate" ? "bg-destructive/5" : ""}`}
            >
              <td
                className={`border-l-2 py-2.5 pl-2.5 text-muted-foreground ${row.zone === "promote" ? "border-l-secondary" : row.zone === "relegate" ? "border-l-destructive" : "border-l-transparent"}`}
              >
                {row.rank}
              </td>
              <td className="max-w-0 py-2.5 pr-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span aria-hidden="true" className="shrink-0">{row.emoji ?? "🎯"}</span>
                  <span className="truncate font-semibold">{row.name}</span>
                  {row.zone === "promote" && <ArrowUp aria-label={t("league.zonePromote")} className="h-3.5 w-3.5 shrink-0 text-secondary" />}
                  {row.zone === "relegate" && <ArrowDown aria-label={t("league.zoneRelegate")} className="h-3.5 w-3.5 shrink-0 text-destructive" />}
                </span>
              </td>
              <td className="py-2.5 text-center text-muted-foreground">{row.played}</td>
              <td className="py-2.5 text-center text-muted-foreground">{row.won}</td>
              <td className="py-2.5 text-center text-muted-foreground">{row.legsFor}:{row.legsAgainst}</td>
              <td className="py-2.5 pr-3 text-right font-display text-lg font-bold leading-none text-primary">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default LeagueStandingsTable;
