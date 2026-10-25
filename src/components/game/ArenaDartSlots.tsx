import { Target } from "lucide-react";

export interface ArenaSlotDart {
  /** What the player reads: "T20", "D16", "25", "Bull", "–" for a miss. */
  label: string;
  points: number;
  /** Not yet taken over (camera / Autodarts is still showing it). */
  live?: boolean;
}

interface ArenaDartSlotsProps {
  darts: ArenaSlotDart[];
  /** Points of this round so far. */
  total: number;
  /** Round number shown under the total. */
  roundLabel: string;
  /** Checkout route toggle — the same switch the classic scoreboard has in its info line. */
  checkout?: { active: boolean; label: string; onToggle: () => void };
  /** Tapping a slot opens the throw corrector (not offered during a bot's turn). */
  onTapSlot?: () => void;
}

/** A bare dart as a placeholder in an empty slot. */
const DartGlyph = () => (
  <svg viewBox="0 0 40 40" className="h-7 w-7 opacity-25" aria-hidden>
    <path d="M6 34 L26 14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <path d="M26 14 L34 6 M26 14 L30 20 M26 14 L20 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M26 14 L36 12 L34 6 Z" fill="currentColor" opacity="0.6" />
  </svg>
);

/**
 * The three dart slots of the round on the oche, with the round's total in front: the darts that already landed
 * show their value, the slot that is next pulses, the rest wait with a dart outline. Replaces the row of small
 * chips inside the classic scoreboard card.
 */
const ArenaDartSlots = ({ darts, total, roundLabel, checkout, onTapSlot }: ArenaDartSlotsProps) => (
  <div className="flex items-stretch gap-2">
    <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl border border-border/60 bg-card/60 py-1.5">
      <span className="font-display text-2xl leading-none tabular-nums text-foreground">{total}</span>
      <span className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{roundLabel}</span>
    </div>
    <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
      {[0, 1, 2].map((i) => {
        const dart = darts[i];
        const isNext = !dart && i === darts.length;
        const Tag = onTapSlot && dart ? "button" : "div";
        return (
          <Tag
            key={i}
            {...(Tag === "button" ? { type: "button" as const, onClick: onTapSlot } : {})}
            className={`relative flex h-14 min-w-0 flex-col items-center justify-center rounded-xl border text-center transition-all ${
              dart
                ? dart.live
                  ? "border-accent/50 bg-accent/10"
                  : "border-primary/40 bg-primary/10"
                : isNext
                  ? "animate-pulse-glow border-dashed border-primary/60 bg-card/40 text-primary"
                  : "border-dashed border-border/60 bg-card/30 text-muted-foreground"
            }`}
          >
            {dart ? (
              <>
                <span className={`font-display text-xl leading-none ${dart.live ? "text-accent" : "text-foreground"}`}>{dart.label}</span>
                {dart.label !== String(dart.points) && <span className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">{dart.points}</span>}
              </>
            ) : (
              <DartGlyph />
            )}
          </Tag>
        );
      })}
    </div>
    {checkout && (
      <button
        type="button"
        onClick={checkout.onToggle}
        aria-pressed={checkout.active}
        aria-label={checkout.label}
        title={checkout.label}
        className={`flex w-11 shrink-0 items-center justify-center rounded-xl border transition-colors ${checkout.active ? "border-primary/50 bg-primary/15 text-primary" : "border-border/60 bg-card/30 text-muted-foreground"}`}
      >
        <Target className="h-5 w-5" />
      </button>
    )}
  </div>
);

export default ArenaDartSlots;
