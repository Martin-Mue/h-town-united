import { useState } from "react";

/** Available base score values on a dartboard */
const BOARD_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** Common 3-dart round scores for one-tap entry — tucked behind a toggle by default so the
 *  per-dart flow (the 95% case) isn't competing with it for attention. */
const QUICK_ROUNDS = [180, 140, 121, 100, 85, 81, 60, 45, 41, 26, 0];

interface DartScoreInputProps {
  isDisabled: boolean;
  /** Submits one dart. */
  onThrow: (value: number, multiplier: number) => void;
  /** Optional: submit a full 3-dart round at once with a total score */
  onQuickRound?: (total: number) => void;
}

/**
 * Score input, v4: back to "every field is its own button" (v2's approach) — a multiplier
 * selector, even one that resets automatically (v3), was still reported as too error-prone in
 * real play. This time each number is a wider, taller card (4 columns instead of 5, so each
 * cell is noticeably bigger) with the Single hit as the dominant tap target and Double/Triple
 * as clearly separate, still-comfortably-sized buttons below it — rather than 3 equally-thin
 * stacked slivers, which was the actual problem with v2, not the one-button-per-field idea itself.
 */
const DartScoreInput = ({ isDisabled, onThrow, onQuickRound }: DartScoreInputProps) => {
  const [showQuickRound, setShowQuickRound] = useState(false);

  return (
    <div className="bg-card rounded-xl border border-border p-3">
      {/* Number grid — 4 wide so each card has real room; Single dominates, Double/Triple sit
          below as their own full-width-of-card buttons. One tap anywhere submits immediately.
          Padding/font sizes trimmed from the original v4 pass (still clearly the same dominant-
          Single-over-smaller-T/D shape, just less of it) after reports of needing to scroll to
          see every field — the column count and stacked-not-side-by-side shape stay untouched,
          since those are what fixed the actual mis-tap problem in v2/v3 (see the comment above). */}
      <div className="grid grid-cols-4 gap-1.5 mb-2">
        {BOARD_NUMBERS.map((v) => (
          <div key={v} className="rounded-xl overflow-hidden border border-border/60">
            <button
              onClick={() => onThrow(v, 1)}
              disabled={isDisabled}
              title={`Einfach ${v}`}
              className="w-full py-2 text-lg font-bold bg-muted text-foreground transition-all hover:bg-muted/70 active:scale-95 active:bg-primary active:text-primary-foreground disabled:opacity-40"
            >
              {v}
            </button>
            <div className="grid grid-cols-2 gap-px bg-border/60">
              <button
                onClick={() => onThrow(v, 3)}
                disabled={isDisabled}
                title={`Dreifach ${v}`}
                className="py-1.5 text-xs font-bold bg-primary/15 text-primary transition-all hover:bg-primary/30 active:scale-95 active:bg-primary active:text-primary-foreground disabled:opacity-40"
              >
                T
              </button>
              <button
                onClick={() => onThrow(v, 2)}
                disabled={isDisabled}
                title={`Doppel ${v}`}
                className="py-1.5 text-xs font-bold bg-secondary/15 text-secondary transition-all hover:bg-secondary/30 active:scale-95 active:bg-secondary active:text-secondary-foreground disabled:opacity-40"
              >
                D
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Special targets: Miss, Bull, Bullseye — always submit immediately (fixed multiplier).
          Bullseye is baseValue 25 + multiplier 2 (NOT baseValue 50 — that encoding silently
          broke every double-out/double-in check in x01Rules.ts, which only ever looks at
          multiplier === 2; a double-out finish on the bullseye was wrongly scored as a bust).
          25×2 is the same convention every other dart source (LiveCamera.tsx, botPlayer.ts)
          already uses, and cricket's own targetNumber/hitsToAdd math already special-cased
          baseValue===50 to behave identically to 25×2 — so this doesn't change cricket scoring,
          it just makes that special-case dead code (points: 25*2=50, targetNumber: 25 either way). */}
      <div className="flex gap-1.5 mb-2">
        {[
          { value: 0, mul: 1 as const, label: "Miss" },
          { value: 25, mul: 1 as const, label: "Bull (25)" },
          { value: 25, mul: 2 as const, label: "Bullseye (50)" },
        ].map((target) => (
          <button
            key={target.label}
            onClick={() => onThrow(target.value, target.mul)}
            disabled={isDisabled}
            className="flex-1 px-2 py-2 rounded-lg text-sm font-bold transition-all bg-accent/15 text-accent hover:bg-accent/25 active:scale-95 disabled:opacity-40"
          >
            {target.label}
          </button>
        ))}
      </div>

      {onQuickRound && (
        <div>
          <button
            onClick={() => setShowQuickRound((v) => !v)}
            className="w-full text-[11px] text-muted-foreground hover:text-foreground text-center py-1"
          >
            {showQuickRound ? "Schnell-Eingabe (3 Darts) ausblenden ▲" : "Schnell-Eingabe (3 Darts) einblenden ▼"}
          </button>
          {showQuickRound && (
            <div className="grid grid-cols-6 gap-1.5 mt-1.5">
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
          )}
        </div>
      )}
    </div>
  );
};

export default DartScoreInput;
