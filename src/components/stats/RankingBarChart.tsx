const BAR_COLORS = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)",
  "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)",
];

export interface RankingBarDatum {
  id: string;
  name: string;
  emoji: string;
  /** Raw magnitude for bar length — NaN/non-finite (no data for this stat yet) renders an empty bar. */
  value: number;
  /** Already-formatted value for display (matches whatever the list view next to this shows). */
  displayValue: string;
}

/** Horizontal bar-chart view for a ranking drill-down — one bar per player, colored from a fixed
 *  8-slot categorical palette (index.css --chart-1..8, CVD-validated, light/dark aware) with a
 *  legend below. Capped to the top 8: past that, per-player hues stop being reliably
 *  distinguishable, and the full ranked list rendered alongside this already covers everyone —
 *  this chart is a glanceable summary, not the complete reference. */
export const RankingBarChart = ({ data, moreLabel }: { data: RankingBarDatum[]; moreLabel: (count: number) => string }) => {
  const top = data.slice(0, 8);
  if (top.length === 0) return null;

  const finiteValues = top.map((d) => d.value).filter((v) => Number.isFinite(v));
  const max = finiteValues.length > 0 ? Math.max(...finiteValues) : 0;
  const hiddenCount = data.length - top.length;

  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        {top.map((d, i) => {
          const hasValue = Number.isFinite(d.value) && max > 0;
          const pct = hasValue ? Math.max(3, (d.value / max) * 100) : 0;
          return (
            <div key={d.id} className="flex items-center gap-2.5">
              <span className="w-4 text-right text-[10px] text-muted-foreground shrink-0 font-mono">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-xs font-medium truncate">{d.emoji} {d.name}</span>
                  <span className="text-xs font-display shrink-0" style={{ color: BAR_COLORS[i] }}>{d.displayValue}</span>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: BAR_COLORS[i] }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-3 border-t border-border/60">
        {top.map((d, i) => (
          <div key={d.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: BAR_COLORS[i] }} />
            <span className="truncate max-w-[140px]">{d.emoji} {d.name}</span>
          </div>
        ))}
      </div>
      {hiddenCount > 0 && <p className="text-[10px] text-muted-foreground">{moreLabel(hiddenCount)}</p>}
    </div>
  );
};

export default RankingBarChart;
