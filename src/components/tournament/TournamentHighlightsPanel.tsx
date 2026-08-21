import DartboardHeatmap from "@/components/stats/DartboardHeatmap";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";
import { mergeTournamentStats, type TournamentHighlights, type TournamentAverages, type ParticipantStatsRow, type GameAverageRow } from "@/utils/tournamentStats";
import { useLanguage } from "@/contexts/LanguageContext";

interface TournamentHighlightsPanelProps {
  highlights: TournamentHighlights;
  averages: TournamentAverages;
  /** Off for the compact Live-view widget (spectator screen space is tight there) — on for the
   *  full creator-facing bracket view, where "where did everyone actually throw" is the point.
   *  Also simply has nothing to show for a tournament played without the camera at all — the
   *  average/per-match numbers below don't depend on it either way. */
  showHeatmap?: boolean;
  /** For the unattended spectator TV/tablet rotation — nobody there to click "mehr anzeigen", so
   *  the usual collapse-at-5 teaser (right choice on a page someone's actually browsing) would
   *  just permanently hide everyone past the first 5 highlight-earners. Shows the full list
   *  instead, split into side-by-side tables once it's long enough to benefit from the width a
   *  live TV/tablet screen actually has, mirroring the participants grid's "fit without scrolling"
   *  treatment. Also renders a size notch larger, for legibility from normal TV viewing distance. */
  liveView?: boolean;
}

const STAT_SPLIT_THRESHOLD = 8;
const GAME_SPLIT_THRESHOLD = 6;

function chunkInHalf<T>(items: T[]): T[][] {
  const half = Math.ceil(items.length / 2);
  return [items.slice(0, half), items.slice(half)];
}

/** Shared by Tournament.tsx (full, with heatmap) and PublicTournament.tsx's compact live widget
 *  (table only) — one component so both surfaces stay in sync instead of two hand-kept copies. */
const TournamentHighlightsPanel = ({ highlights, averages, showHeatmap, liveView }: TournamentHighlightsPanelProps) => {
  const { t } = useLanguage();
  const merged = mergeTournamentStats(highlights, averages);
  const paged = usePagedList(merged, liveView ? { collapseAt: Infinity } : undefined);
  const pagedGames = usePagedList(averages.games, liveView ? { collapseAt: Infinity } : undefined);

  if (merged.length === 0 && highlights.heatmapPoints.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">{t("tournament.noHighlightsYet")}</p>;
  }

  const rowText = liveView ? "text-sm" : "text-xs";
  const headText = liveView ? "text-[11px]" : "text-[10px]";
  const statCols = liveView && paged.visible.length > STAT_SPLIT_THRESHOLD ? chunkInHalf(paged.visible) : [paged.visible];
  const gameCols = liveView && pagedGames.visible.length > GAME_SPLIT_THRESHOLD ? chunkInHalf(pagedGames.visible) : [pagedGames.visible];

  const renderStatsTable = (rows: ParticipantStatsRow[]) => (
    <table className={`w-full ${rowText}`}>
      <thead>
        <tr className={`text-left ${headText} uppercase text-muted-foreground`}>
          <th className="py-1 pr-2">{t("stats.player")}</th>
          <th className="py-1 px-1.5 text-center" title={t("tournament.tournamentAverage")}>Ø</th>
          <th className="py-1 px-1.5 text-center" title="180er">180</th>
          <th className="py-1 px-1.5 text-center" title="Checkout ≥100">100+</th>
          <th className="py-1 px-1.5 text-center" title="Checkout ≥120">120+</th>
          <th className="py-1 px-1.5 text-center" title="Checkout ≥140">140+</th>
          <th className="py-1 px-1.5 text-center" title="Checkout ≥160">160+</th>
          <th className="py-1 px-1.5 text-center" title={t("tournament.bigFishTooltip")}>170 🐟</th>
          <th className="py-1 px-1.5 text-center" title={t("tournament.bigTriplesTooltip")}>{t("tournament.bigTriplesAbbrev")}</th>
          <th className="py-1 pl-1.5 text-center" title="Bull">Bull</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.key} className="border-t border-border/60">
            <td className="py-1.5 pr-2 font-medium truncate max-w-[140px]">{p.name}</td>
            <td className="py-1.5 px-1.5 text-center font-mono text-primary">{p.tournamentAverage > 0 ? p.tournamentAverage.toFixed(1) : "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono">{p.oneEighties || "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono">{p.checkout100Plus || "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono">{p.checkout120Plus || "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono">{p.checkout140Plus || "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono">{p.checkout160Plus || "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono">{p.checkout170 || "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono">{p.bigTriples || "–"}</td>
            <td className="py-1.5 pl-1.5 text-center font-mono">{p.bulls || "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderGamesList = (rows: GameAverageRow[]) => (
    <div className="space-y-1">
      {rows.map((g) => (
        <div key={g.gameId} className={`flex items-center justify-between ${rowText} bg-muted/30 rounded-lg px-2.5 py-1.5`}>
          <span className="truncate max-w-[35%]">{g.player1Name}</span>
          <span className="font-mono text-primary shrink-0">{g.player1Average.toFixed(1)} : {g.player2Average.toFixed(1)}</span>
          <span className="truncate max-w-[35%] text-right">{g.player2Name}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {showHeatmap && highlights.heatmapPoints.length > 0 && (
        <div className="flex justify-center">
          <DartboardHeatmap points={highlights.heatmapPoints} />
        </div>
      )}
      {paged.visible.length > 0 && (
        <div>
          <div className={`grid gap-x-6 gap-y-3 ${statCols.length > 1 ? "xl:grid-cols-2" : ""}`}>
            {statCols.map((rows, i) => (
              <div key={i} className="overflow-x-auto">{renderStatsTable(rows)}</div>
            ))}
          </div>
          <p className={`${headText} text-muted-foreground pt-1.5`}>{t("tournament.checkoutTierLegend")}</p>
          <ListPaginationFooter list={paged} />
        </div>
      )}

      {pagedGames.visible.length > 0 && (
        <div>
          <p className={`${headText} uppercase tracking-widest text-muted-foreground mb-1.5`}>{t("tournament.gameAveragePerMatch")}</p>
          <div className={`grid gap-x-6 gap-y-1 ${gameCols.length > 1 ? "xl:grid-cols-2" : ""}`}>
            {gameCols.map((rows, i) => <div key={i}>{renderGamesList(rows)}</div>)}
          </div>
          <ListPaginationFooter list={pagedGames} />
        </div>
      )}
    </div>
  );
};

export default TournamentHighlightsPanel;
