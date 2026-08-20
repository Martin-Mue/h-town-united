import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isAchievableVisitTotal } from "@/utils/dartStats";

/** Available base score values on a dartboard */
const BOARD_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** Common 3-dart round scores for one-tap entry — deliberately not just the high/maximum ones
 *  (180/140/121/100), so a scorekeeper racing through an ordinary visit (not just a big one) can
 *  still one-tap it. Order is roughly high-to-low, matching how a scorekeeper scans for a value. */
const QUICK_ROUNDS = [180, 170, 140, 121, 100, 85, 81, 60, 45, 41, 40, 32, 26, 9, 0];

export type DartInputMode = "single" | "quick" | "total";

const MODE_LABEL: Record<DartInputMode, string> = { single: "Einzeln", quick: "Schnell", total: "Eintippen" };

interface DartScoreInputProps {
  isDisabled: boolean;
  /** Submits one dart. */
  onThrow: (value: number, multiplier: number) => void;
  /** Optional: submit a full 3-dart round at once with a total score */
  onQuickRound?: (total: number) => void;
  /** Controlled by the caller (Game.tsx persists it mid-game) when provided; falls back to
   *  internal state otherwise, so callers with no use for persistence (e.g. Training.tsx drills)
   *  don't need to wire it up. */
  inputMode?: DartInputMode;
  onInputModeChange?: (mode: DartInputMode) => void;
  /** How many darts have already landed in the CURRENT visit. Schnell/Eintippen both resolve
   *  their submission as a fresh 3-dart visit against the current remaining score (see
   *  submitDetectedRound in Game.tsx) — switching into them after 1–2 darts already went in via
   *  the single-dart pad would submit those on top of the already-thrown ones instead of
   *  replacing them, desyncing remaining/checkout math. So they're only offered at the start of
   *  a visit; default 0 so callers that don't track this (e.g. Training.tsx drills) are
   *  unaffected. */
  dartsThisRound?: number;
}

/**
 * Score input, v4: back to "every field is its own button" (v2's approach) — a multiplier
 * selector, even one that resets automatically (v3), was still reported as too error-prone in
 * real play. This time each number is a wider, taller card (4 columns instead of 5, so each
 * cell is noticeably bigger) with the Single hit as the dominant tap target and Double/Triple
 * as clearly separate, still-comfortably-sized buttons below it — rather than 3 equally-thin
 * stacked slivers, which was the actual problem with v2, not the one-button-per-field idea itself.
 *
 * v5: the per-dart pad, the quick-round grid, and a typed-total field are now three switchable
 * MODES instead of the quick-round grid being a collapsible extra bolted onto the pad — built for
 * running a real multi-hour, multi-board club tournament, where different scorekeepers reasonably
 * want different tradeoffs between speed and per-dart detail, and the same scorekeeper may want to
 * switch mid-game (e.g. per-dart while it's close, typed totals once a leg is a formality).
 */
const DartScoreInput = ({ isDisabled, onThrow, onQuickRound, inputMode, onInputModeChange, dartsThisRound = 0 }: DartScoreInputProps) => {
  const [localMode, setLocalMode] = useState<DartInputMode>("single");
  const [totalText, setTotalText] = useState("");
  const mode = inputMode ?? localMode;
  const setMode = onInputModeChange ?? setLocalMode;
  const midVisit = dartsThisRound > 0;
  // What actually renders — forced to "single" mid-visit regardless of the stored mode (see
  // dartsThisRound doc above). Deliberately doesn't write this back through setMode: the only
  // way to reach a partial visit is by throwing via the single-dart pad in the first place, so
  // in normal play `mode` is already "single" by the time this matters; this only guards a
  // state-desync edge case (e.g. a mid-visit page reload restoring a stale mode).
  const effectiveMode = midVisit ? "single" : mode;

  const totalValue = totalText.trim() === "" ? null : Number(totalText);
  const totalValid = totalValue !== null && isAchievableVisitTotal(totalValue);
  const submitTotal = () => {
    if (!onQuickRound || !totalValid) return;
    onQuickRound(totalValue);
    setTotalText("");
  };

  return (
    <div className="bg-card rounded-xl border border-border p-3">
      {/* Mode switch — always visible, not tucked behind a collapse toggle, since the whole point
          is being able to change tack at any moment mid-game without hunting for the control. */}
      {onQuickRound && (
        <div className="grid grid-cols-3 gap-1 mb-2.5 p-0.5 rounded-lg bg-muted/50">
          {(["single", "quick", "total"] as const).map((m) => {
            const locked = midVisit && m !== "single";
            return (
              <button
                key={m}
                onClick={() => !locked && setMode(m)}
                disabled={locked}
                title={locked ? "Erst zu Beginn der nächsten Aufnahme verfügbar" : undefined}
                className={`py-2 rounded-md text-xs font-bold uppercase tracking-wide transition-all ${
                  effectiveMode === m ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                } ${locked ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                {MODE_LABEL[m]}
              </button>
            );
          })}
        </div>
      )}
      {onQuickRound && midVisit && (
        <p className="text-[10px] text-muted-foreground text-center -mt-1.5 mb-2">
          Schnell/Eintippen erst zu Beginn der nächsten Aufnahme
        </p>
      )}

      {effectiveMode === "single" && (
        <>
          {/* Number grid — 4 wide so each card has real room; Single dominates, Double/Triple sit
              below as their own full-width-of-card buttons. One tap anywhere submits immediately. */}
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
          <div className="flex gap-1.5">
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
        </>
      )}

      {effectiveMode === "quick" && onQuickRound && (
        <div className="grid grid-cols-5 gap-1.5">
          {QUICK_ROUNDS.map((v) => (
            <button
              key={v}
              onClick={() => onQuickRound(v)}
              disabled={isDisabled}
              className="py-3 rounded-lg text-sm font-bold bg-secondary/20 text-foreground hover:bg-secondary/40 active:scale-95 transition-all disabled:opacity-40"
            >
              {v}
            </button>
          ))}
        </div>
      )}

      {effectiveMode === "total" && onQuickRound && (
        <div className="flex flex-col items-center gap-2 py-2">
          <p className="text-xs text-muted-foreground text-center">Gesamtpunktzahl der Aufnahme (0–180)</p>
          <div className="flex gap-2 w-full max-w-[240px]">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={180}
              value={totalText}
              onChange={(e) => setTotalText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitTotal(); }}
              disabled={isDisabled}
              placeholder="z. B. 100"
              className="text-center text-lg font-bold bg-background border-border"
            />
            <Button onClick={submitTotal} disabled={isDisabled || !totalValid} className="shrink-0">
              Eintragen
            </Button>
          </div>
          {totalValue !== null && !totalValid && (
            <p className="text-[11px] text-destructive">
              {totalValue > 180 || totalValue < 0 || !Number.isInteger(totalValue)
                ? "Ungültige Punktzahl (0–180)."
                : `${totalValue} ist mit 3 Darts nicht erreichbar.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default DartScoreInput;
