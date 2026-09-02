const SEGMENT_COLORS = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)",
  "var(--chart-5)", "var(--chart-6)", "var(--chart-7)",
];
const OTHER_COLOR = "hsl(var(--muted-foreground) / 0.35)";

export interface RankingBarDatum {
  id: string;
  name: string;
  emoji: string;
  /** Raw magnitude this player contributes — must be >= 0. Non-finite/zero is excluded from the stack. */
  value: number;
  /** Already-formatted value for display (matches whatever the list view next to this shows). */
  displayValue: string;
}

/** A single vertical bar for the currently-selected stat, sliced into one colored segment per
 *  player proportional to their share of the club total — not one bar per player. Named colors
 *  go to the top 7 contributors (index.css --chart-1..7, CVD-validated, light/dark aware);
 *  anyone past that folds into one neutral-grey "Andere" segment rather than a generated 8th hue,
 *  which would stop being reliably distinguishable. A legend below the bar carries the exact
 *  values — the bar itself is proportion-only, segments are too thin to label in place. */
export const RankingBarChart = ({ data }: { data: RankingBarDatum[] }) => {
  // Sorted here rather than trusted from the caller — the bar view can show several stats at
  // once, each needing its own descending order, while the caller's array is only ever sorted by
  // whichever single stat currently drives the list (see Statistics.tsx's sortBy/leaderboard).
  const contributors = data.filter((d) => Number.isFinite(d.value) && d.value > 0).sort((a, b) => b.value - a.value);
  if (contributors.length === 0) return null;

  const top = contributors.slice(0, 7);
  const rest = contributors.slice(7);
  const restTotal = rest.reduce((sum, d) => sum + d.value, 0);
  const total = top.reduce((sum, d) => sum + d.value, 0) + restTotal;

  const segments = [
    ...top.map((d, i) => ({ id: d.id, label: `${d.emoji} ${d.name}`, value: d.value, displayValue: d.displayValue, color: SEGMENT_COLORS[i] })),
    ...(rest.length > 0 ? [{ id: "__other", label: `Andere (${rest.length})`, value: restTotal, displayValue: String(restTotal), color: OTHER_COLOR }] : []),
  ];

  return (
    <div className="flex flex-col items-center">
      <p className="text-[11px] text-muted-foreground mb-3">Σ {Number.isInteger(total) ? total : total.toFixed(1)}</p>
      <div className="w-24 h-64 rounded-xl overflow-hidden flex flex-col bg-muted shrink-0">
        {segments.map((s) => (
          <div
            key={s.id}
            className="w-full border-t border-background/40 first:border-t-0 transition-all duration-500"
            style={{ height: `${(s.value / total) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.displayValue}`}
          />
        ))}
      </div>

      <div className="w-full mt-4 space-y-1.5 pt-3 border-t border-border/60">
        {segments.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</span>
            <span className="shrink-0 font-mono text-muted-foreground">{s.displayValue}</span>
            <span className="shrink-0 font-mono text-muted-foreground w-10 text-right">{((s.value / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RankingBarChart;
