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
  /** Currently selected multiplier — sticky across throws (stays on "T" for a run of triples, etc.) */
  selectedMultiplier: number;
  /** Whether input is disabled (e.g., game finished) */
  isDisabled: boolean;
  /** Callback when a multiplier is selected */
  onMultiplierSelect: (multiplier: number) => void;
  /** Tapping a number/target submits that single dart immediately at the current multiplier. */
  onThrow: (value: number, multiplier: number) => void;
  /** Optional: submit a full 3-dart round at once with a total score */
  onQuickRound?: (total: number) => void;
}

/**
 * Score input component with number grid, multiplier selection, and special targets.
 * One tap on a number registers that dart right away at whichever multiplier is currently
 * selected — no separate "confirm" step. The multiplier stays selected across throws so a
 * run of triples (e.g. T20, T20, T20) only takes one multiplier tap total.
 */
const DartScoreInput = ({
  selectedMultiplier,
  isDisabled,
  onMultiplierSelect,
  onThrow,
  onQuickRound,
}: DartScoreInputProps) => {
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

      {/* Multiplier selection — sticky, applies to every number tap until changed */}
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground text-center mb-1.5">
        1. Vervielfacher wählen (bleibt aktiv)
      </div>
      <div className="flex gap-2 mb-3 justify-center">
        {MULTIPLIER_OPTIONS.map((m) => (
          <button
            key={m.value}
            onClick={() => onMultiplierSelect(m.value)}
            disabled={isDisabled}
            className={`flex-1 max-w-28 px-5 py-3 rounded-lg text-base font-bold transition-all disabled:opacity-40 ${
              selectedMultiplier === m.value
                ? "bg-primary text-primary-foreground glow-cyan scale-105"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {m.fullLabel}
          </button>
        ))}
      </div>

      {/* Number grid (1-20) — tapping submits the dart immediately */}
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground text-center mb-1.5">
        2. Zahl antippen zum Eintragen
      </div>
      <div className="grid grid-cols-5 gap-1.5 mb-3">
        {BOARD_NUMBERS.map((v) => (
          <button
            key={v}
            onClick={() => onThrow(v, selectedMultiplier)}
            disabled={isDisabled}
            className="aspect-square rounded-lg text-base font-bold transition-all bg-muted text-foreground hover:bg-primary/20 active:scale-90 active:bg-primary active:text-primary-foreground disabled:opacity-40"
          >
            {v}
          </button>
        ))}
      </div>

      {/* Special targets: Miss, Bull, Bullseye — always submit immediately (fixed multiplier).
          Bullseye uses baseValue 50 (not 25×2) to match the cricket/X01 scoring convention
          used throughout Game.tsx (targetNumber = baseValue === 50 ? 25 : baseValue). */}
      <div className="flex gap-2 justify-center">
        {[
          { value: 0, mul: 1 as const, label: "Miss" },
          { value: 25, mul: 1 as const, label: "Bull (25)" },
          { value: 50, mul: 1 as const, label: "Bullseye (50)" },
        ].map((target) => (
          <button
            key={target.label}
            onClick={() => onThrow(target.value, target.mul)}
            disabled={isDisabled}
            className="flex-1 px-3 py-3 rounded-lg text-sm font-bold transition-all bg-accent/15 text-accent hover:bg-accent/25 active:scale-95 disabled:opacity-40"
          >
            {target.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default DartScoreInput;
