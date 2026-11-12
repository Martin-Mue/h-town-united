export interface ChoiceOption<T extends string | number> {
  value: T;
  label: string;
}

interface ChoiceChipsProps<T extends string | number> {
  label: string;
  /** T is inferred from `value` alone, so a plain string state accepts literal options and vice versa. */
  options: ChoiceOption<NoInfer<T>>[];
  value: T;
  onChange: (value: NoInfer<T>) => void;
  /** Tailwind grid-cols class; defaults to one column per option. */
  columnsClass?: string;
}

/** Single-choice chip row (redesign canvas "Spielmodus"/"Auschecken"): the picked chip is outlined in the primary color. */
function ChoiceChips<T extends string | number>({ label, options, value, onChange, columnsClass }: ChoiceChipsProps<T>) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <div
        role="group"
        aria-label={label}
        className={`grid gap-2 ${columnsClass ?? ""}`}
        style={columnsClass ? undefined : { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={`min-h-12 rounded-xl border px-2 py-2 text-sm font-semibold leading-tight transition-colors ${
                selected ? "border-primary bg-primary/15 text-primary" : "border-border bg-card text-foreground hover:bg-muted"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ChoiceChips;
