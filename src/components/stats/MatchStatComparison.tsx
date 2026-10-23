import type { StatBundle } from "@/utils/dartStats";
import { averageToCheckoutRange } from "@/utils/averageToCheckoutRange";

export interface ComparedPlayer {
  name: string;
  won: boolean;
  bundle: StatBundle;
}

interface ComparisonRow {
  label: string;
  /** Raw numbers used for the bar proportions and for deciding who leads; null = no data. */
  values: [number | null, number | null];
  format: (value: number) => string;
}

const decimal = (v: number) => v.toFixed(1);
const percent = (v: number) => `${v.toFixed(0)}%`;
const whole = (v: number) => String(v);

const rowsFor = (a: StatBundle, b: StatBundle, labels: { averageTo170: string; highscore: string }): ComparisonRow[] => [
  { label: "Ø", values: [a.average, b.average], format: decimal },
  { label: labels.averageTo170, values: [averageToCheckoutRange(a.scoringPhase), averageToCheckoutRange(b.scoringPhase)], format: decimal },
  { label: "First 9", values: [a.first9, b.first9], format: decimal },
  { label: "CO %", values: [a.checkout.percentage, b.checkout.percentage], format: percent },
  { label: labels.highscore, values: [a.highscore, b.highscore], format: whole },
  { label: "100+", values: [a.tonPlus, b.tonPlus], format: whole },
  { label: "180", values: [a.s180, b.s180], format: whole },
];

/** One stat as a mirrored bar pair (player 1 grows left, player 2 right) so who leads is visible
 *  at a glance, with the leading number in the accent colour. */
const ComparisonBarRow = ({ row }: { row: ComparisonRow }) => {
  const [left, right] = row.values;
  const max = Math.max(left ?? 0, right ?? 0);
  const widthFor = (v: number | null) => (v && max > 0 ? `${Math.max((v / max) * 100, 4)}%` : "0%");
  const leads = (mine: number | null, other: number | null) => mine !== null && other !== null && mine > other;
  const cell = (value: number | null, isLeading: boolean, align: "left" | "right") => (
    <span className={`font-display text-base tabular-nums ${align === "left" ? "text-left" : "text-right"} ${isLeading ? "text-secondary" : "text-foreground"}`}>
      {value === null ? "–" : row.format(value)}
    </span>
  );
  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2">
        {cell(left, leads(left, right), "left")}
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground text-center">{row.label}</span>
        {cell(right, leads(right, left), "right")}
      </div>
      <div className="grid grid-cols-2 gap-1 mt-1">
        <div className="h-1.5 rounded-full bg-muted/40 flex justify-end overflow-hidden">
          <div className={`h-full rounded-full ${leads(left, right) ? "bg-secondary" : "bg-muted-foreground/40"}`} style={{ width: widthFor(left) }} />
        </div>
        <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
          <div className={`h-full rounded-full ${leads(right, left) ? "bg-secondary" : "bg-muted-foreground/40"}`} style={{ width: widthFor(right) }} />
        </div>
      </div>
    </div>
  );
};

/** Head-to-head match totals for exactly two sides: names on top, one mirrored bar row per stat. */
const MatchStatComparison = ({ players, labels }: { players: [ComparedPlayer, ComparedPlayer]; labels: { averageTo170: string; highscore: string } }) => {
  const [a, b] = players;
  const nameCell = (p: ComparedPlayer, align: "left" | "right") => (
    <span className={`text-sm truncate ${align === "right" ? "text-right" : "text-left"} ${p.won ? "text-secondary font-semibold" : "text-foreground"}`}>
      {p.won && "🏆 "}{p.name}
    </span>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {nameCell(a, "left")}
        {nameCell(b, "right")}
      </div>
      {rowsFor(a.bundle, b.bundle, labels).map((row) => <ComparisonBarRow key={row.label} row={row} />)}
    </div>
  );
};

export default MatchStatComparison;
