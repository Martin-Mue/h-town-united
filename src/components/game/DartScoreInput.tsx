import { useState } from "react";
import { RotateCcw } from "lucide-react";

/** Available base score values on a dartboard */
const BOARD_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const MULTIPLIER_OPTIONS = [
  { label: "Single", short: "S", value: 1 },
  { label: "Double", short: "D", value: 2 },
  { label: "Triple", short: "T", value: 3 },
] as const;

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

const dartLabel = (value: number, mul: number) => {
  if (value === 0) return "Miss";
  if (value === 25) return mul === 2 ? "Bullseye" : "Bull";
  return `${mul === 3 ? "T" : mul === 2 ? "D" : ""}${value}`;
};

/**
 * Score input, v3: a big Single/Double/Triple selector up top (auto-resets to Single after
 * every dart — see below), a big 5-wide number grid, and a "letzten Wurf wiederholen" button
 * for fast repeats without needing the multiplier to stay sticky. Earlier versions tried (a)
 * a sticky multiplier + big grid, which caused mis-scored darts when the multiplier was left on
 * D/T from the previous throw, and (b) a 60-button dense S/D/T-per-number grid, which fixed
 * that but became too cramped to tap accurately and hard to scan at a glance. This combines the
 * bigger/clearer layout of (a) with a safe default (always resets to Single) and adds a
 * dedicated repeat button so a run of the same shot (e.g. T20, T20, T20) is still one tap each.
 */
const DartScoreInput = ({ isDisabled, onThrow, onQuickRound }: DartScoreInputProps) => {
  const [multiplier, setMultiplier] = useState(1);
  const [lastDart, setLastDart] = useState<{ value: number; multiplier: number } | null>(null);
  const [justReset, setJustReset] = useState(false);
  const [showQuickRound, setShowQuickRound] = useState(false);

  const submit = (value: number, mul: number) => {
    onThrow(value, mul);
    setLastDart({ value, multiplier: mul });
    if (mul !== 1) {
      setMultiplier(1);
      setJustReset(true);
      window.setTimeout(() => setJustReset(false), 500);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      {/* Repeat-last-dart — the fast path for a run of the same shot, without the multiplier
          having to stay selected (and risk being forgotten) between taps. */}
      {lastDart && (
        <button
          onClick={() => submit(lastDart.value, lastDart.multiplier)}
          disabled={isDisabled}
          className="w-full mb-3 py-2.5 rounded-lg text-sm font-bold bg-accent/15 text-accent hover:bg-accent/25 active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4" /> {dartLabel(lastDart.value, lastDart.multiplier)} wiederholen
        </button>
      )}

      {/* Multiplier — big, obvious, and always snaps back to Single right after use (flashes
          briefly so the reset itself is visible, not just inferred). */}
      <div className="flex gap-2 mb-3">
        {MULTIPLIER_OPTIONS.map((m) => (
          <button
            key={m.value}
            onClick={() => setMultiplier(m.value)}
            disabled={isDisabled}
            className={`flex-1 py-4 rounded-xl text-base font-bold transition-all disabled:opacity-40 ${
              multiplier === m.value
                ? "bg-primary text-primary-foreground glow-cyan scale-[1.03]"
                : "bg-muted text-muted-foreground hover:text-foreground"
            } ${justReset && m.value === 1 ? "ring-2 ring-accent" : ""}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {multiplier !== 1 && (
        <p className="text-center text-[11px] text-accent uppercase tracking-wider -mt-1.5 mb-2.5 font-semibold">
          {multiplier === 3 ? "Triple" : "Double"} aktiv — als nächstes eine Zahl antippen
        </p>
      )}

      {/* Number grid — one tap submits at the multiplier selected above. */}
      <div className="grid grid-cols-5 gap-2 mb-3">
        {BOARD_NUMBERS.map((v) => (
          <button
            key={v}
            onClick={() => submit(v, multiplier)}
            disabled={isDisabled}
            className="aspect-square rounded-xl text-lg font-bold transition-all bg-muted text-foreground hover:bg-primary/20 active:scale-90 active:bg-primary active:text-primary-foreground disabled:opacity-40"
          >
            {v}
          </button>
        ))}
      </div>

      {/* Special targets — always their own fixed value, ignore the multiplier selector. */}
      <div className="flex gap-2 mb-3">
        {[
          { value: 0, mul: 1 as const, label: "Miss" },
          { value: 25, mul: 1 as const, label: "Bull (25)" },
          { value: 50, mul: 1 as const, label: "Bullseye (50)" },
        ].map((target) => (
          <button
            key={target.label}
            onClick={() => submit(target.value, target.mul)}
            disabled={isDisabled}
            className="flex-1 px-3 py-3 rounded-lg text-sm font-bold transition-all bg-accent/15 text-accent hover:bg-accent/25 active:scale-95 disabled:opacity-40"
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
