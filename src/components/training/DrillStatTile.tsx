import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DrillStatTileProps {
  label: ReactNode;
  value: ReactNode;
  className?: string;
  valueClassName?: string;
  children?: ReactNode;
}

/** Label-over-big-number tile for a finished drill's results (Statistik canvas tile style). */
const DrillStatTile = ({ label, value, className, valueClassName, children }: DrillStatTileProps) => (
  <div className={cn("rounded-2xl border border-border bg-card px-3.5 py-3 text-left", className)}>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={cn("font-display text-[34px] font-bold leading-tight tabular-nums", valueClassName)}>{value}</p>
    {children}
  </div>
);

export default DrillStatTile;
