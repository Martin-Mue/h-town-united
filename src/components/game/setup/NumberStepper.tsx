import { Minus, Plus } from "lucide-react";

interface NumberStepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
  disabled?: boolean;
}

/** − value + with 48 px buttons; the value itself is the big display number. */
const NumberStepper = ({ value, min, max, onChange, decreaseLabel, increaseLabel, disabled }: NumberStepperProps) => {
  const buttonClass = "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button type="button" aria-label={decreaseLabel} className={buttonClass} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus className="h-5 w-5" />
      </button>
      <span className="w-8 text-center font-display text-3xl font-bold tabular-nums">{value}</span>
      <button type="button" aria-label={increaseLabel} className={buttonClass} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus className="h-5 w-5" />
      </button>
    </div>
  );
};

export default NumberStepper;
