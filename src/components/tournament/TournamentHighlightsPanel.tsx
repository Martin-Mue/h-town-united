import DartboardHeatmap from "@/components/stats/DartboardHeatmap";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";
import { mergeTournamentStats, type TournamentHighlights, type TournamentAverages } from "@/utils/tournamentStats";

interface TournamentHighlightsPanelProps {
  highlights: TournamentHighlights;
  averages: TournamentAverages;
  /** Off for the compact Live-view widget (spectator screen space is tight there) — on for the
   *  full creator-facing bracket view, where "where did everyone actually throw" is the point.
   *  Also simply has nothing to show for a tournament played without the camera at all — the
   *  average/per-match numbers below don't depend on it either way. */
  showHeatmap?: boolean;
}

/** Shared by Tournament.tsx (full, with heatmap) and PublicTournament.tsx's compact live widget
 *  (table only) — one component so both surfaces stay in sync instead of two hand-kept copies. */
const TournamentHighlightsPanel = ({ highlights, averages, showHeatmap }: TournamentHighlightsPanelProps) => {
  const merged = mergeTournamentStats(highlights, averages);
  const paged = usePagedList(merged);
  const pagedGames = usePagedList(averages.games);

  if (merged.length === 0 && highlights.heatmapPoints.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">Noch keine Highlights in diesem Turnier.</p>;
  }

  return (
    <div className="space-y-4">
      {showHeatmap && highlights.heatmapPoints.length > 0 && (
        <div className="flex justify-center">
          <DartboardHeatmap points={highlights.heatmapPoints} />
        </div>
      )}
      {paged.visible.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase text-muted-foreground">
                <th className="py-1 pr-2">Spieler</th>
                <th className="py-1 px-1.5 text-center" title="Turnier-Average">Ø</th>
                <th className="py-1 px-1.5 text-center" title="180er">180</th>
                <th className="py-1 px-1.5 text-center" title="170-Finish (Maximum)">170</th>
                <th className="py-1 px-1.5 text-center" title="Ton-Plus-Finishes (≥100)">Ton+</th>
                <th className="py-1 px-1.5 text-center" title="Große Triples (T16–T20)">Triple</th>
                <th className="py-1 pl-1.5 text-center" title="Bull-Treffer">Bull</th>
              </tr>
            </thead>
            <tbody>
              {paged.visible.map((p) => (
                <tr key={p.key} className="border-t border-border/60">
                  <td className="py-1.5 pr-2 font-medium truncate max-w-[120px]">{p.name}</td>
                  <td className="py-1.5 px-1.5 text-center font-mono text-primary">{p.tournamentAverage > 0 ? p.tournamentAverage.toFixed(1) : "–"}</td>
                  <td className="py-1.5 px-1.5 text-center font-mono">{p.oneEighties || "–"}</td>
                  <td className="py-1.5 px-1.5 text-center font-mono">{p.maxCheckouts || "–"}</td>
                  <td className="py-1.5 px-1.5 text-center font-mono">{p.tonPlusFinishes || "–"}</td>
                  <td className="py-1.5 px-1.5 text-center font-mono">{p.bigTriples || "–"}</td>
                  <td className="py-1.5 pl-1.5 text-center font-mono">{p.bulls || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ListPaginationFooter list={paged} />
        </div>
      )}

      {pagedGames.visible.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Spiel-Average je Partie</p>
          <div className="space-y-1">
            {pagedGames.visible.map((g) => (
              <div key={g.gameId} className="flex items-center justify-between text-xs bg-muted/30 rounded-lg px-2.5 py-1.5">
                <span className="truncate max-w-[35%]">{g.player1Name}</span>
                <span className="font-mono text-primary shrink-0">{g.player1Average.toFixed(1)} : {g.player2Average.toFixed(1)}</span>
                <span className="truncate max-w-[35%] text-right">{g.player2Name}</span>
              </div>
            ))}
          </div>
          <ListPaginationFooter list={pagedGames} />
        </div>
      )}
    </div>
  );
};

export default TournamentHighlightsPanel;
