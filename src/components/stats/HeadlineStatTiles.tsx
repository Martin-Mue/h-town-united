import type { LucideIcon } from "lucide-react";

export interface HeadlineStatTile {
  key: string;
  label: string;
  value: string;
  /** Record-style numbers (180s, highest finish) are set in the accent color. The Dartspot
   *  theme's accent is a pale cream that barely differs from the text color, so an accent tile
   *  always comes with an icon to carry the distinction. */
  accentIcon?: LucideIcon;
}

/** 2-column grid of headline numbers under the average card (Checkout-Quote, 180er, ...). */
const HeadlineStatTiles = ({ tiles }: { tiles: HeadlineStatTile[] }) => (
  <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
    {tiles.map(({ key, label, value, accentIcon: Icon }) => (
      <div key={key} className="rounded-2xl border border-border bg-card px-3.5 py-3 min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className={`flex items-center gap-1.5 font-display font-bold text-[34px] leading-[1.1] tabular-nums ${Icon ? "text-accent" : "text-foreground"}`}>
          {Icon && <Icon className="w-5 h-5 shrink-0" aria-hidden />}
          <span className="truncate">{value}</span>
        </p>
      </div>
    ))}
  </section>
);

export default HeadlineStatTiles;
