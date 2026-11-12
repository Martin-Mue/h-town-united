import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TrainingOptionChipProps {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  className?: string;
  /** Display-font label, for chips that show a number or a field (20, T20, 301). */
  numeric?: boolean;
}

/** One selectable option in a Training settings picker — the redesign's chip: flat card, primary
 *  outline + tint when selected, at least 44px tall for touch. */
const TrainingOptionChip = ({ selected, onSelect, children, className, numeric = false }: TrainingOptionChipProps) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onSelect}
    className={cn(
      "min-h-11 min-w-0 rounded-xl border px-2 transition-colors",
      numeric ? "font-display text-lg font-bold tabular-nums" : "text-sm font-semibold",
      selected ? "border-primary bg-primary/15 text-primary" : "border-border bg-card text-foreground hover:border-primary/40",
      className,
    )}
  >
    {children}
  </button>
);

export default TrainingOptionChip;
