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
  /** Shown above the total (e.g. "Round 4"). */
  roundLabel: string;
  /** Checkout route toggle — the same switch the classic scoreboard has in its info line. */
  checkout?: { active: boolean; label: string; onToggle: () => void };
  /** Tapping a slot opens the throw corrector (not offered during a bot's turn). */
  onTapSlot?: () => void;
}

/** A bare dart as a placeholder in an empty slot. */
const DartGlyph = () => (
  <svg viewBox="0 0 40 40" className="h-6 w-6 opacity-25" aria-hidden>
    <path d="M6 34 L26 14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <path d="M26 14 L34 6 M26 14 L30 20 M26 14 L20 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M26 14 L36 12 L34 6 Z" fill="currentColor" opacity="0.6" />
  </svg>
);

/**
 * The three dart slots of the round on the oche with the round's total next to them: darts that already landed show
 * their value, the slot that is next is outlined in the accent colour, the rest wait with a dart outline. The same
 * row sits in the manual and the camera play screen.
 */
const ArenaDartSlots = ({ darts, total, roundLabel, checkout, onTapSlot }: ArenaDartSlotsProps) => (
  <div className="flex items-stretch gap-2">
    <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
      {[0, 1, 2].map((i) => {
        const dart = darts[i];
        const isNext = !dart && i === darts.length;
        const Tag = onTapSlot && dart ? "button" : "div";
        return (
          <Tag
            key={i}
            {...(Tag === "button" ? { type: "button" as const, onClick: onTapSlot } : {})}
            className={`relative flex h-12 min-w-0 flex-col items-center justify-center rounded-xl border bg-card text-center transition-colors portrait:short:h-10 compactland:h-10 tablet:h-16 ${
              dart
                ? dart.live
                  ? "border-accent/60"
                  : "border-border"
                : isNext
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground"
            }`}
          >
            {dart ? (
              <>
                <span className={`font-display text-2xl font-bold leading-none portrait:short:text-xl tablet:text-3xl ${dart.live ? "text-accent" : "text-foreground"}`}>{dart.label}</span>
                {dart.label !== String(dart.points) && <span className="text-[10px] leading-none tabular-nums text-muted-foreground">{dart.points}</span>}
              </>
            ) : (
              <DartGlyph />
            )}
          </Tag>
        );
      })}
    </div>
    <div className="flex w-[4.5rem] shrink-0 flex-col items-end justify-center tablet:w-24">
      <span className="max-w-full truncate text-[11px] leading-tight text-muted-foreground tablet:text-xs">{roundLabel}</span>
      <span className="font-display text-[1.75rem] font-bold leading-none tabular-nums text-foreground portrait:short:text-2xl tablet:text-4xl">{total}</span>
    </div>
    {checkout && (
      <button
        type="button"
        onClick={checkout.onToggle}
        aria-pressed={checkout.active}
        aria-label={checkout.label}
        title={checkout.label}
        className={`flex w-11 shrink-0 items-center justify-center rounded-xl border transition-colors tablet:w-16 ${checkout.active ? "border-primary/50 bg-primary/15 text-primary" : "border-border bg-card text-muted-foreground"}`}
      >
        <Target className="h-5 w-5" />
      </button>
    )}
  </div>
);

export default ArenaDartSlots;
