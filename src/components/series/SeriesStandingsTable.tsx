import { useLanguage } from "@/contexts/LanguageContext";

export interface SeriesStandingsTableRow {
  name: string;
  rank: number;
  tournaments: number;
  champions: number;
  points: number;
}

/** Overall standings of a tournament series: compact table with tabular numbers, scrolls inside its own box on a phone. */
const SeriesStandingsTable = ({ rows }: { rows: SeriesStandingsTableRow[] }) => {
  const { t } = useLanguage();
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[300px] text-sm tabular-nums">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            <th scope="col" className="w-9 py-2 pl-3 text-left font-medium">#</th>
            <th scope="col" className="py-2 text-left font-medium">{t("stats.player")}</th>
            <th scope="col" className="w-16 py-2 text-center font-medium">{t("series.colTournaments")}</th>
            <th scope="col" className="w-14 py-2 text-center font-medium">{t("series.colTitles")}</th>
            <th scope="col" className="w-14 py-2 pr-3 text-right font-medium">{t("tournament.pointsAbbrev")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-border/60 last:border-b-0">
              <td className="py-2.5 pl-3 text-muted-foreground">{row.rank}</td>
              <td className="max-w-0 truncate py-2.5 pr-2 font-semibold">{row.name}</td>
              <td className="py-2.5 text-center text-muted-foreground">{row.tournaments}</td>
              <td className="py-2.5 text-center text-muted-foreground">{row.champions > 0 ? row.champions : "–"}</td>
              <td className="py-2.5 pr-3 text-right font-display text-lg font-bold leading-none text-primary">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default SeriesStandingsTable;
