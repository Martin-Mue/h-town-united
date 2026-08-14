import { Button } from "@/components/ui/button";

/** Available base score values on a dartboard */
const BOARD_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** Common 3-dart round scores for one-tap entry */
const QUICK_ROUNDS = [180, 140, 121, 100, 85, 81, 60, 45, 41, 26, 0];

interface DartScoreInputProps {
  /** Whether input is disabled (e.g., game finished) */
  isDisabled: boolean;
  /** Tapping any field (S/D/T of a number, or a special target) submits that dart immediately. */
  onThrow: (value: number, multiplier: number) => void;
  /** Optional: submit a full 3-dart round at once with a total score */
  onQuickRound?: (total: number) => void;
}

/**
 * Score input: every scorable field (Single/Double/Triple of every number, plus Miss/Bull/
 * Bullseye) is its own directly-tappable button — no "pick a multiplier, then pick a number"
 * two-step and no multiplier state that can be left selected from the previous dart. Each
 * number gets a compact 3-row stack (T on top, big single in the middle since it's the most
 * common hit, D on the bottom) so the whole board fits without a separate mode switch.
 */
const DartScoreInput = ({ isDisabled, onThrow, onQuickRound }: DartScoreInputProps) => {
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

      {/* Number grid (1-20) — each number is its own T/S/D button stack, tap = submit immediately */}
      <div className="grid grid-cols-5 gap-1 mb-3">
        {BOARD_NUMBERS.map((v) => (
          <div key={v} className="flex flex-col gap-0.5">
            <button
              onClick={() => onThrow(v, 3)}
              disabled={isDisabled}
              title={`Dreifach ${v}`}
              className="rounded-t-md py-1 text-[11px] font-bold bg-primary/15 text-primary transition-all hover:bg-primary/30 active:scale-90 active:bg-primary active:text-primary-foreground disabled:opacity-40"
            >
              T
            </button>
            <button
              onClick={() => onThrow(v, 1)}
              disabled={isDisabled}
              title={`Einfach ${v}`}
              className="py-2 text-base font-bold bg-muted text-foreground transition-all hover:bg-muted/70 active:scale-90 active:bg-primary active:text-primary-foreground disabled:opacity-40"
            >
              {v}
            </button>
            <button
              onClick={() => onThrow(v, 2)}
              disabled={isDisabled}
              title={`Doppel ${v}`}
              className="rounded-b-md py-1 text-[11px] font-bold bg-secondary/15 text-secondary transition-all hover:bg-secondary/30 active:scale-90 active:bg-secondary active:text-secondary-foreground disabled:opacity-40"
            >
              D
            </button>
          </div>
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
