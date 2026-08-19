import DartboardHeatmap from "@/components/stats/DartboardHeatmap";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";
import type { TournamentHighlights } from "@/utils/tournamentStats";

interface TournamentHighlightsPanelProps {
  highlights: TournamentHighlights;
  /** Off for the compact Live-view widget (spectator screen space is tight there) — on for the
   *  full creator-facing bracket view, where "where did everyone actually throw" is the point. */
  showHeatmap?: boolean;
}

/** Shared by Tournament.tsx (full, with heatmap) and PublicTournament.tsx's compact live widget
 *  (table only) — one component so both surfaces stay in sync instead of two hand-kept copies. */
const TournamentHighlightsPanel = ({ highlights, showHeatmap }: TournamentHighlightsPanelProps) => {
  const paged = usePagedList(highlights.participants);

  if (highlights.participants.length === 0 && highlights.heatmapPoints.length === 0) {
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
    </div>
  );
};

export default TournamentHighlightsPanel;
