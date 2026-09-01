import { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** Shared visual language for the Statistics redesign — every section here replaces the old
 *  ad-hoc `bg-card rounded-xl border border-border p-4 mb-4` + inline `.map(s => <div ...>)`
 *  pattern repeated ~15 times across Statistics.tsx with one consistent, reusable set of
 *  building blocks, so "professionalize the whole page" means changing tokens in one place
 *  instead of hand-tuning every card individually. Pure presentation — none of these carry
 *  their own data logic, they only lay out values already computed elsewhere. */

/** Small uppercase section label, optionally with a leading icon — the one recurring heading
 *  style across every card (mirrors the app's existing `font-display text-sm uppercase
 *  text-muted-foreground` convention, just centralized). */
export const Eyebrow = ({ icon: Icon, children, tone = "muted" }: { icon?: LucideIcon; children: ReactNode; tone?: "muted" | "primary" | "accent" }) => (
  <h3 className={`font-display text-sm uppercase mb-3 flex items-center gap-2 ${tone === "primary" ? "text-primary" : tone === "accent" ? "text-accent" : "text-muted-foreground"}`}>
    {Icon && <Icon className="w-4 h-4" />}
    {children}
  </h3>
);

/** Standard card shell. `glow` adds the accent gradient + border treatment reserved for the one
 *  or two highest-priority moments per view (a section's own hero number), never used for
 *  routine content — overusing it would just make it the new wall of noise. */
export const SectionCard = ({ children, glow, className = "" }: { children: ReactNode; glow?: "primary" | "accent"; className?: string }) => (
  <div
    className={`rounded-xl border p-4 ${
      glow === "primary"
        ? "border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card shadow-[0_0_30px_hsl(var(--primary)/0.12)]"
        : glow === "accent"
        ? "border-accent/30 bg-gradient-to-br from-accent/10 via-card to-card shadow-[0_0_24px_hsl(var(--accent)/0.1)]"
        : "border-border bg-card"
    } ${className}`}
  >
    {children}
  </div>
);

// Tailwind's JIT scanner only picks up class names that appear literally in source — a
// template-interpolated `text-${tone}` would silently compile to nothing, so every tone maps to
// a fully-written class string here instead. Exported since several call sites (icon tints on a
// custom-laid-out card, not just StatTile itself) need the same tone->class mapping.
export const TONE_TEXT: Record<"foreground" | "primary" | "secondary" | "accent" | "destructive" | "muted", string> = {
  foreground: "text-foreground",
  primary: "text-primary",
  secondary: "text-secondary",
  accent: "text-accent",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

/** One value in a `grid grid-cols-N` stat block — replaces the `{[{label,value,color}].map(...)}`
 *  block repeated for every X01/Cricket mini stat-grid in Statistics.tsx. */
export const StatTile = ({ label, value, tone = "foreground", icon: Icon }: { label: string; value: ReactNode; tone?: keyof typeof TONE_TEXT; icon?: LucideIcon }) => (
  <div className="text-center">
    {Icon && <Icon className={`w-3.5 h-3.5 mx-auto mb-1 ${tone === "foreground" ? "text-muted-foreground" : TONE_TEXT[tone]}`} />}
    <p className={`font-display text-lg ${TONE_TEXT[tone]}`}>{value}</p>
    <p className="text-[10px] text-muted-foreground">{label}</p>
  </div>
);

/** A trend delta pill, e.g. "+2.1" with an up/down arrow — used beside a hero number wherever a
 *  comparison to a previous period exists. */
export const TrendBadge = ({ delta, suffix = "" }: { delta: number; suffix?: string }) => {
  if (delta === 0) return null;
  const up = delta > 0;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${up ? "bg-secondary/15 text-secondary" : "bg-destructive/15 text-destructive"}`}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        {up ? <path d="M7 17l5-5 4 4 6-6M17 6h6v6" /> : <path d="M7 7l5 5 4-4 6 6M17 18h6v-6" />}
      </svg>
      {up ? "+" : ""}{delta.toFixed(1)}{suffix}
    </span>
  );
};

/** Inline SVG sparkline — no charting library weight for what's just a shape, used wherever a
 *  hero number benefits from an at-a-glance trend (club-leader average, a player's own average
 *  over their last N games). `values` plots left-to-right in the order given. */
export const Sparkline = ({ values, tone = "primary", height = 40 }: { values: number[]; tone?: "primary" | "secondary"; height?: number }) => {
  if (values.length < 2) return null;
  const w = 300;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = w / (values.length - 1);
  const points = values.map((v, i) => `${i * stepX},${height - 4 - ((v - min) / range) * (height - 8)}`).join(" ");
  const gradId = `spark-grad-${tone}`;
  const colorVar = tone === "primary" ? "hsl(var(--primary))" : "hsl(var(--secondary))";
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full block" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colorVar} stopOpacity={0.35} />
          <stop offset="100%" stopColor={colorVar} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke={colorVar} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <polygon points={`0,${height} ${points} ${w},${height}`} fill={`url(#${gradId})`} />
    </svg>
  );
};

/** Circular percentage ring — replaces a bare "63%" with a glanceable shape for checkout%/hit-rate
 *  style stats. `size` in px; stroke is proportional. */
export const RingStat = ({ percent, tone = "secondary", size = 40 }: { percent: number; tone?: "primary" | "secondary" | "accent"; size?: number }) => {
  const stroke = Math.max(3, size * 0.11);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const colorVar = tone === "primary" ? "hsl(var(--primary))" : tone === "accent" ? "hsl(var(--accent))" : "hsl(var(--secondary))";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colorVar} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (clamped / 100) * c}
      />
    </svg>
  );
};

/** Circular initial/emoji avatar with an optional rank-colored ring (gold/silver/bronze for
 *  top 3, plain border otherwise) — replaces the bare emoji + "🥇/🥈/🥉" text combo in every
 *  ranked list (leaderboard, ranking-focus drill-down). */
export const RankAvatar = ({ emoji, rank, size = 32 }: { emoji: string; rank?: number; size?: number }) => {
  const ringTone =
    rank === 1 ? "border-accent bg-accent/15" :
    rank === 2 ? "border-muted-foreground/50 bg-muted" :
    rank === 3 ? "border-orange-400/60 bg-orange-400/10" :
    "border-border bg-muted";
  return (
    <div className={`shrink-0 rounded-full border flex items-center justify-center ${ringTone}`} style={{ width: size, height: size }}>
      <span style={{ fontSize: size * 0.5 }}>{emoji}</span>
    </div>
  );
};

/** The numeric rank marker ("1", "2", ...) beside a RankAvatar — top 3 get accent/silver/bronze
 *  ink, matching RankAvatar's ring so the two always agree. */
export const RankBadge = ({ rank }: { rank: number }) => (
  <span className={`w-6 shrink-0 text-center font-display text-sm ${rank === 1 ? "text-accent" : rank === 2 ? "text-muted-foreground" : rank === 3 ? "text-orange-400" : "text-muted-foreground"}`}>
    {rank}
  </span>
);
