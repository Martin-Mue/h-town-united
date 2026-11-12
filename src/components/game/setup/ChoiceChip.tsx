import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface ChoiceChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected: boolean;
}

/** One option of a single-choice row (mode, out rule, input method, …): outlined, and tinted in the club colour when chosen. */
const ChoiceChip = ({ selected, className, children, ...rest }: ChoiceChipProps) => (
  <button
    type="button"
    aria-pressed={selected}
    className={cn(
      "min-h-[48px] min-w-0 rounded-xl border px-3 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      selected ? "border-primary bg-primary/15 text-primary" : "border-border bg-card text-foreground hover:bg-muted",
      className,
    )}
    {...rest}
  >
    {children}
  </button>
);

export default ChoiceChip;
