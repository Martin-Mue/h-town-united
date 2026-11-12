import type { LucideIcon } from "lucide-react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** "tabs" switches between panels (Settings tabs), "choice" picks one value (input mode, voice). */
  kind?: "tabs" | "choice";
  /** Literal Tailwind grid-cols classes, e.g. "grid-cols-2 md:grid-cols-4". */
  columnsClassName: string;
  /** Surface behind the segments: bg-card on the page, bg-background inside a card. */
  surfaceClassName?: string;
}

/** Redesign segmented switch (like the canvas Statistik period switch): one bordered strip, the
 *  active segment filled with the action color. At least 44px tall per segment. */
const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  kind = "choice",
  columnsClassName,
  surfaceClassName = "bg-card",
}: SegmentedControlProps<T>) => (
  <div
    role={kind === "tabs" ? "tablist" : "radiogroup"}
    aria-label={ariaLabel}
    className={`grid gap-1 rounded-[14px] border border-border p-1 ${surfaceClassName} ${columnsClassName}`}
  >
    {options.map((option) => {
      const isActive = option.value === value;
      const Icon = option.icon;
      return (
        <button
          key={option.value}
          type="button"
          role={kind === "tabs" ? "tab" : "radio"}
          aria-selected={kind === "tabs" ? isActive : undefined}
          aria-checked={kind === "choice" ? isActive : undefined}
          onClick={() => onChange(option.value)}
          className={`flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-[10px] px-2 text-sm font-semibold transition-colors ${
            isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {Icon && <Icon aria-hidden="true" className="hidden h-4 w-4 shrink-0 sm:block" />}
          <span className="truncate">{option.label}</span>
        </button>
      );
    })}
  </div>
);

export default SegmentedControl;
