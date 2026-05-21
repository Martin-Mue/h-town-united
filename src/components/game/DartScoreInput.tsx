import { Button } from "@/components/ui/button";

/** Available base score values on a dartboard */
const BOARD_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const MULTIPLIER_OPTIONS = [
  { label: "S", fullLabel: "Single", value: 1 },
  { label: "D", fullLabel: "Double", value: 2 },
  { label: "T", fullLabel: "Triple", value: 3 },
] as const;

/** Common 3-dart round scores for one-tap entry */
const QUICK_ROUNDS = [180, 140, 121, 100, 85, 81, 60, 45, 41, 26, 0];

interface DartScoreInputProps {
  /** Currently selected base value */
  selectedValue: number;
  /** Currently selected multiplier */
  selectedMultiplier: number;
  /** Whether input is disabled (e.g., game finished) */
  isDisabled: boolean;
  /** Callback when a base value is selected */
  onValueSelect: (value: number) => void;
  /** Callback when a multiplier is selected */
  onMultiplierSelect: (multiplier: number) => void;
  /** Callback to submit the throw */
  onSubmit: () => void;
  /** Optional: submit a full 3-dart round at once with a total score */
  onQuickRound?: (total: number) => void;
}

/**
 * Score input component with number grid, multiplier selection, and special targets.
 * Reusable across different game modes for manual dart entry.
 */
const DartScoreInput = ({
  selectedValue,
  selectedMultiplier,
  isDisabled,
  onValueSelect,
  onMultiplierSelect,
  onSubmit,
  onQuickRound,
}: DartScoreInputProps) => {
  const calculatedPoints = selectedValue === 0 ? 0 : selectedValue * selectedMultiplier;
  const isInvalidCombo = selectedValue === 25 && selectedMultiplier === 3;

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      {/* Quick 3-dart round scores */}
      {onQuickRound && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground text-center mb-1.5">
            Schnell-Eingabe (3 Darts)
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {QUICK_ROUNDS.map((v) => (
              <button
                key={v}
                onClick={() => onQuickRound(v)}
                disabled={isDisabled}
                className="py-1.5 rounded-md text-xs font-bold bg-secondary/20 text-foreground hover:bg-secondary/40 transition-colors disabled:opacity-40"
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Multiplier selection */}
      <div className="flex gap-2 mb-3 justify-center">
        {MULTIPLIER_OPTIONS.map((m) => (
          <button
            key={m.value}
            onClick={() => onMultiplierSelect(m.value)}
            className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${
              selectedMultiplier === m.value
                ? "bg-primary text-primary-foreground glow-cyan"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {m.fullLabel}
          </button>
        ))}
      </div>

      {/* Number grid (1-20) */}
      <div className="grid grid-cols-7 gap-1.5 mb-3">
        {BOARD_NUMBERS.map((v) => (
          <button
            key={v}
            onClick={() => onValueSelect(v)}
            className={`aspect-square rounded-lg text-sm font-bold transition-all ${
              selectedValue === v
                ? "bg-primary text-primary-foreground scale-110"
                : "bg-muted text-foreground hover:bg-muted/80"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Special targets: Miss, Bull, Bullseye */}
      <div className="flex gap-2 mb-3 justify-center">
        {[
          { value: 0, label: "Miss" },
          { value: 25, label: "Bull" },
          { value: 50, label: "Bullseye" },
        ].map((target) => (
          <button
            key={target.value}
            onClick={() => {
              onValueSelect(target.value);
              if (target.value >= 25) onMultiplierSelect(1);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              selectedValue === target.value
                ? "bg-accent text-accent-foreground"
                : "bg-muted text-foreground hover:bg-muted/80"
            }`}
          >
            {target.label}
          </button>
        ))}
      </div>

      {/* Points preview */}
      <div className="text-center mb-3">
        <span className="text-3xl font-display text-primary">
          {isInvalidCombo ? "—" : calculatedPoints}
        </span>
        <span className="text-sm text-muted-foreground ml-2">Punkte</span>
      </div>

      <Button
        onClick={onSubmit}
        className="w-full font-display uppercase text-lg py-5"
        disabled={isDisabled || isInvalidCombo}
      >
        Wurf eintragen
      </Button>
    </div>
  );
};

export default DartScoreInput;
