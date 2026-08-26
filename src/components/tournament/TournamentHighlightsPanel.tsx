import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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
/** Which column (if any) the stats table below is currently sorted by — "default" keeps
 *  mergeTournamentStats' own ordering (highlight-magnitude, then average as a tiebreak).
 *  "gamesPlayed" exists specifically so someone eliminated round 1 on a single lucky visit
 *  doesn't sit at the top of every other sort looking like the tournament's best player forever
 *  — sorting by games played surfaces the small sample size instead of hiding it. */
type StatSortKey = "default" | "average" | "oneEighties" | "checkout" | "tonPlus" | "gamesPlayed";

const TournamentHighlightsPanel = ({ highlights, averages, showHeatmap, liveView }: TournamentHighlightsPanelProps) => {
  const { t } = useLanguage();
  const [sortKey, setSortKey] = useState<StatSortKey>("default");
  const [expandedGames, setExpandedGames] = useState<Set<string>>(new Set());
  const merged = mergeTournamentStats(highlights, averages);
  const sortedMerged =
    sortKey === "average" ? [...merged].sort((a, b) => b.tournamentAverage - a.tournamentAverage) :
    sortKey === "oneEighties" ? [...merged].sort((a, b) => b.oneEighties - a.oneEighties) :
    sortKey === "checkout" ? [...merged].sort((a, b) =>
      (b.checkout170 - a.checkout170) || (b.checkout160Plus - a.checkout160Plus) ||
      (b.checkout140Plus - a.checkout140Plus) || (b.checkout120Plus - a.checkout120Plus) ||
      (b.checkout100Plus - a.checkout100Plus)) :
    sortKey === "tonPlus" ? [...merged].sort((a, b) => b.tonPlus - a.tonPlus) :
    sortKey === "gamesPlayed" ? [...merged].sort((a, b) => b.gamesPlayed - a.gamesPlayed) :
    merged;
  const paged = usePagedList(sortedMerged, liveView ? { collapseAt: Infinity } : undefined);
  const pagedGames = usePagedList(averages.games, liveView ? { collapseAt: Infinity } : undefined);
  const toggleGameExpanded = (gameId: string) => setExpandedGames((prev) => {
    const next = new Set(prev);
    if (next.has(gameId)) next.delete(gameId); else next.add(gameId);
    return next;
  });

  if (merged.length === 0 && highlights.heatmapPoints.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">{t("tournament.noHighlightsYet")}</p>;
  }

  const rowText = liveView ? "text-sm" : "text-xs";
  const headText = liveView ? "text-[11px]" : "text-[10px]";
  const statCols = liveView && paged.visible.length > STAT_SPLIT_THRESHOLD ? chunkInHalf(paged.visible) : [paged.visible];
  const gameCols = liveView && pagedGames.visible.length > GAME_SPLIT_THRESHOLD ? chunkInHalf(pagedGames.visible) : [pagedGames.visible];

  // Every sortable header shares the same click-to-sort/click-again-to-reset behavior as the
  // headline chips below — the 4 checkout tiers all drive the one "checkout" sort key since
  // they're really the same ranking at different thresholds, so clicking any of them highlights
  // all 4 together rather than looking like only one took effect.
  const sortableHeader = (key: StatSortKey, label: string, tooltip: string) => {
    const active = sortKey === key;
    return (
      <th className="py-1 px-1.5 text-center" aria-sort={active ? "descending" : "none"}>
        <button
          type="button"
          title={tooltip}
          onClick={() => setSortKey((k) => (k === key ? "default" : key))}
          className={`select-none transition-colors ${active ? "text-primary" : "hover:text-foreground"}`}
        >
          {label}{active && <span aria-hidden="true"> ▾</span>}
        </button>
      </th>
    );
  };

  const renderStatsTable = (rows: ParticipantStatsRow[]) => (
    <table className={`w-full ${rowText}`}>
      <thead>
        <tr className={`text-left ${headText} uppercase text-muted-foreground`}>
          <th className="py-1 pr-2">{t("stats.player")}</th>
          {sortableHeader("gamesPlayed", t("tournament.gamesPlayedAbbrev"), t("tournament.gamesPlayedTooltip"))}
          {sortableHeader("average", "Ø", t("tournament.tournamentAverage"))}
          {sortableHeader("oneEighties", "180", t("tournament.oneEightyTooltip"))}
          {sortableHeader("tonPlus", "Ton+", t("tournament.tonPlusTooltip"))}
          {sortableHeader("checkout", "100+", t("tournament.checkout100Tooltip"))}
          {sortableHeader("checkout", "120+", t("tournament.checkout120Tooltip"))}
          {sortableHeader("checkout", "140+", t("tournament.checkout140Tooltip"))}
          {sortableHeader("checkout", "160+", t("tournament.checkout160Tooltip"))}
          <th className="py-1 pl-1.5 text-center" title={t("tournament.bigTriplesTooltip")}>{t("tournament.bigTriplesAbbrev")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.key} className="border-t border-border/60">
            <td className="py-1.5 pr-2 font-medium truncate max-w-[140px]">{p.name}</td>
            <td className="py-1.5 px-1.5 text-center font-mono text-muted-foreground">{p.gamesPlayed || "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono text-primary">{p.tournamentAverage > 0 ? p.tournamentAverage.toFixed(1) : "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono">{p.oneEighties || "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono">{p.tonPlus || "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono">{p.checkout100Plus || "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono">{p.checkout120Plus || "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono">{p.checkout140Plus || "–"}</td>
            <td className="py-1.5 px-1.5 text-center font-mono">{p.checkout160Plus || "–"}</td>
            <td className="py-1.5 pl-1.5 text-center font-mono">{p.bigTriples || "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderGamesList = (rows: GameAverageRow[]) => (
    <div className="space-y-1">
      {rows.map((g) => {
        // Only worth expanding when there's more than one leg to actually break down — a
        // single-leg match's "per leg" average is identical to the match average already shown.
        const expandable = (g.legs?.length ?? 0) > 1;
        const expanded = expandedGames.has(g.gameId);
        const rowContent = (
          <>
            {expandable ? (
              expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            ) : <span className="w-3.5 shrink-0" />}
            <span className="truncate max-w-[32%]">{g.player1Name}</span>
            <span className="font-mono text-primary shrink-0">{g.player1Average.toFixed(1)} : {g.player2Average.toFixed(1)}</span>
            <span className="truncate max-w-[32%] text-right">{g.player2Name}</span>
          </>
        );
        return (
          <div key={g.gameId} className="bg-muted/30 rounded-lg">
            {expandable ? (
              <button
                type="button"
                onClick={() => toggleGameExpanded(g.gameId)}
                className={`w-full flex items-center justify-between gap-2 ${rowText} px-2.5 py-1.5 cursor-pointer`}
                aria-expanded={expanded}
              >
                {rowContent}
              </button>
            ) : (
              <div className={`flex items-center justify-between gap-2 ${rowText} px-2.5 py-1.5`}>{rowContent}</div>
            )}
            {expandable && expanded && (
              <div className="space-y-1 px-2.5 pb-1.5 pl-9">
                {g.legs!.map((leg, i) => (
                  <div key={i} className={`flex items-center justify-between ${headText} text-muted-foreground`}>
                    <span>{t("game.leg")} {i + 1}</span>
                    <span className="font-mono">{leg.player1Average.toFixed(1)} : {leg.player2Average.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const leadingAverage = averages.participants[0]?.tournamentAverage > 0 ? averages.participants[0] : null;
  const mostOneEighties = highlights.participants[0]?.oneEighties ? highlights.participants[0] : null;
  const hasHeadline = leadingAverage || mostOneEighties || highlights.topCheckout || highlights.shortestLeg;

  return (
    <div className="space-y-4">
      {showHeatmap && highlights.heatmapPoints.length > 0 && (
        <div className="flex justify-center">
          <DartboardHeatmap points={highlights.heatmapPoints} />
        </div>
      )}
      {hasHeadline && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* Average/180s/checkout each double as a sort trigger for the full table below — same
           *  "tile doubles as a link into the full ranking" idea as the Records tiles on the
           *  Statistics page, just re-sorting the table already right here instead of navigating
           *  elsewhere. Tapping the already-active one returns to the default ranking. No natural
           *  table column to sort by for shortestLeg (only a single tournament-wide record is
           *  tracked, not a per-player list), so that one stays a plain, non-interactive chip. */}
          {leadingAverage && (
            <button
              type="button"
              onClick={() => setSortKey((k) => (k === "average" ? "default" : "average"))}
              className={`rounded-lg border px-3 py-2 text-center transition-colors ${sortKey === "average" ? "border-primary bg-primary/10" : "border-border bg-muted/20 hover:border-primary/40"}`}
            >
              <p className={`${headText} uppercase tracking-wide text-muted-foreground`} title={t("tournament.tournamentAverage")}>{t("tournament.leadingAverage")}</p>
              <p className="font-display text-lg text-primary">{leadingAverage.tournamentAverage.toFixed(1)}</p>
              <p className={`${rowText} truncate text-muted-foreground`}>{leadingAverage.name}</p>
            </button>
          )}
          {mostOneEighties && (
            <button
              type="button"
              onClick={() => setSortKey((k) => (k === "oneEighties" ? "default" : "oneEighties"))}
              className={`rounded-lg border px-3 py-2 text-center transition-colors ${sortKey === "oneEighties" ? "border-primary bg-primary/10" : "border-border bg-muted/20 hover:border-primary/40"}`}
            >
              <p className={`${headText} uppercase tracking-wide text-muted-foreground`}>{t("tournament.mostOneEighties")}</p>
              <p className="font-display text-lg text-primary">{mostOneEighties.oneEighties}</p>
              <p className={`${rowText} truncate text-muted-foreground`}>{mostOneEighties.name}</p>
            </button>
          )}
          {highlights.topCheckout && (
            <button
              type="button"
              onClick={() => setSortKey((k) => (k === "checkout" ? "default" : "checkout"))}
              className={`rounded-lg border px-3 py-2 text-center transition-colors ${sortKey === "checkout" ? "border-primary bg-primary/10" : "border-border bg-muted/20 hover:border-primary/40"}`}
            >
              <p className={`${headText} uppercase tracking-wide text-muted-foreground`}>{t("tournament.bestCheckout")}</p>
              <p className="font-display text-lg text-primary">{highlights.topCheckout.value}</p>
              <p className={`${rowText} truncate text-muted-foreground`}>{highlights.topCheckout.name}</p>
            </button>
          )}
          {highlights.shortestLeg && (
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-center">
              <p className={`${headText} uppercase tracking-wide text-muted-foreground`}>{t("tournament.shortestLegLabel")}</p>
              <p className="font-display text-lg text-primary">{highlights.shortestLeg.darts} <span className="text-xs font-sans">{t("game.dartsSuffix")}</span></p>
              <p className={`${rowText} truncate text-muted-foreground`}>{highlights.shortestLeg.name}</p>
            </div>
          )}
        </div>
      )}
      {hasHeadline && <p className={`${headText} text-muted-foreground`}>{t("tournament.averageScopeHint")}</p>}
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
