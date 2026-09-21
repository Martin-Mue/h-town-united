import { Edit2, Pencil, Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { isHoleThrow, type DartThrow } from "@/utils/dartStats";

const NUMBERS = Array.from({ length: 20 }, (_, i) => i + 1);

interface ThrowHistoryEditorProps {
  throws: DartThrow[];
  playerName: string;
  editModeOn: boolean;
  onToggleEditMode: () => void;
  /** Which dart's value-edit popover is open (controlled, not per-popover local state) — needed
   *  so the caller can close it once an edit actually commits, e.g. after a state update lands. */
  openChipIdx: number | null;
  onOpenChipChange: (idx: number | null) => void;
  /** Changes one dart's recorded value in place (same position — doesn't reshuffle later darts
   *  into a different visit the way removing one would). */
  onEditThrow: (throwIndex: number, base: number, multiplier: 1 | 2 | 3) => void;
  onDeleteThrow: (throwIndex: number) => void;
  /** Records one more dart for whichever round is short of 3 — chunking `throws` into groups of
   *  exactly 3 (see the round-building loop below) means the ONLY round that can ever be short is
   *  the trailing one, so "complete the short round" and "throw the next dart for this player" are
   *  the same operation; the caller can just feed this straight into its own normal throw handler.
   *  Lets a round left short by an earlier accidental deletion (or a genuinely partial current
   *  round) be completed instead of staying permanently short. Optional: omit alongside
   *  openAddRoundIdx/onOpenAddRoundChange for a caller with no use for it (MatchDetailDialog's
   *  read-only past-match view). */
  onAddThrow?: (base: number, multiplier: 1 | 2 | 3) => void;
  /** Which round's "+ hinzufügen" popover is open (controlled, same reasoning as openChipIdx). */
  openAddRoundIdx?: number | null;
  onOpenAddRoundChange?: (roundIdx: number | null) => void;
  /** Hides the edit-mode toggle entirely, for viewing a past match's history where corrections no
   *  longer apply — pass editModeOn={false} and no-op callbacks alongside this from the caller. */
  readOnly?: boolean;
  /** Only meaningful alongside readOnly: renders a "Korrigieren" button in the header (replacing
   *  the hidden Bearbeiten toggle) that hands control back to the caller instead of flipping
   *  editModeOn locally — Game.tsx uses this to open a dedicated correction dialog rather than
   *  editing inline, see that dialog's own doc comment for why. Omit to render no header button
   *  at all (MatchDetailDialog's plain past-match replay). */
  onOpenCorrector?: () => void;
  /** X01 starting score for this leg — when given, each round also shows the running score
   *  LEFT after that round (not just what was thrown), via plain cumulative subtraction. Safe to
   *  do naively (no bust-rule replay needed): Game.tsx's bust handling already strips a busted
   *  visit's darts back out of the persisted `throws` array before it's ever saved (see its own
   *  `updatedLeg.throws[idx] = ...slice(...)` on bust), so every visit that's actually IN `throws`
   *  already legitimately counted — exactly the same assumption utils/dartStats.ts's own
   *  computeCheckoutStats/checkoutRangeBreakdown already rely on. Omit for Cricket (no "remaining
   *  points" concept there) or when the starting score isn't known. */
  startingScore?: number;
}

/**
 * Round-by-round throw history with correction tools per dart: tap the chip to open a popover
 * that either changes its VALUE (a compact one-tap-commits grid, same "no separate multiplier
 * step" philosophy as DartScoreInput, just smaller to fit a popover) or deletes it outright via
 * that SAME popover's own "Wurf löschen" button — deliberately not a separate always-visible
 * delete badge floating on the chip's corner (an earlier version had one): with two stacked tap
 * targets that close together, a tap meant for "open the editor" could land on "delete" instead,
 * with no confirmation at all, exactly the mis-tap a real user hit against this component. Routing
 * every deletion through the popover means it always takes two deliberate taps, never one
 * accidental one. Edit mode (the "Bearbeiten" toggle) stays on across multiple corrections in the
 * same pass — closing after every single edit meant reopening it per dart, which was the actual
 * complaint this component exists to fix.
 */
const ThrowHistoryEditor = ({ throws, playerName, editModeOn, onToggleEditMode, openChipIdx, onOpenChipChange, onEditThrow, onDeleteThrow, onAddThrow, openAddRoundIdx, onOpenAddRoundChange, readOnly, onOpenCorrector, startingScore }: ThrowHistoryEditorProps) => {
  const { t } = useLanguage();
  if (throws.length === 0) return null;

  return (
    <div className="mt-3 gradient-card rounded-xl border border-border shadow-elevation-sm p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground uppercase font-display">{t("game.throwsHeading")} · {playerName}</p>
        {!readOnly && (
          <button onClick={onToggleEditMode} className="text-xs text-primary flex items-center gap-1">
            <Edit2 className="w-3 h-3" /> {editModeOn ? t("game.done") : t("game.edit")}
          </button>
        )}
        {readOnly && onOpenCorrector && (
          <button onClick={onOpenCorrector} className="text-xs text-primary flex items-center gap-1">
            <Pencil className="w-3 h-3" /> {t("game.correctThrows")}
          </button>
        )}
      </div>
      <div className="space-y-1">
        {Array.from({ length: Math.ceil(throws.length / 3) }, (_, roundIdx) => {
          const roundThrows = throws.slice(roundIdx * 3, roundIdx * 3 + 3);
          // A round with an unfilled hole (see isHoleThrow) isn't really complete even though it
          // occupies all 3 array slots — its total/running-remaining would be misleadingly LOW
          // (the hole itself always contributes 0) until it's filled back in, so both display as
          // "..." exactly like a genuinely-partial round does.
          const hasHole = roundThrows.some(isHoleThrow);
          const roundComplete = roundThrows.length === 3 && !hasHole;
          const roundTotal = roundThrows.reduce((s, dart) => s + dart.points, 0);
          const is180 = roundTotal === 180 && roundComplete;
          // Running score LEFT after this round — plain cumulative subtraction over everything
          // thrown so far. Safe without any bust-rule replay: see startingScore's own doc comment
          // above (a busted visit's darts never make it into `throws` to begin with).
          const remainingAfterRound = startingScore === undefined || !roundComplete ? undefined
            : startingScore - throws.slice(0, roundIdx * 3 + roundThrows.length).reduce((s, dart) => s + dart.points, 0);
          return (
            <div key={roundIdx} className={`flex items-center gap-2.5 px-2 py-1 rounded ${is180 ? "bg-accent/10 border border-accent/30" : ""}`}>
              <span className="text-[10px] text-muted-foreground w-4">{roundIdx + 1}.</span>
              {roundThrows.map((dart, i) => {
                const globalIdx = roundIdx * 3 + i;
                const isHole = isHoleThrow(dart);
                const chip = isHole ? null : (
                  <span className={`inline-block px-2.5 py-1 rounded text-sm font-mono ${
                    dart.multiplier === 3 ? "bg-primary/20 text-primary" :
                    dart.multiplier === 2 ? "bg-secondary/20 text-secondary" : "bg-muted text-foreground"
                  } ${dart.corrected ? "ring-2 ring-amber-500/70" : ""}`}
                    title={dart.corrected ? t("game.correctedMarker") : undefined}
                  >
                    {dart.multiplier === 3 ? "T" : dart.multiplier === 2 ? "D" : ""}{dart.baseValue === 50 ? t("game.bull") : dart.baseValue === 0 ? t("game.miss") : dart.baseValue}
                  </span>
                );
                const holeButton = (
                  <button title={t("game.addThrow")} aria-label={t("game.addThrow")}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-dashed border-primary/40 text-primary hover:bg-primary/10">
                    <Plus className="w-4 h-4" />
                  </button>
                );
                return (
                  <div key={globalIdx}>
                    {editModeOn ? (
                      <Popover open={openChipIdx === globalIdx} onOpenChange={(open) => onOpenChipChange(open ? globalIdx : null)}>
                        <PopoverTrigger asChild>
                          {isHole ? holeButton : (
                            <button title={t("game.changeValue")} aria-label={t("game.changeValue")}>{chip}</button>
                          )}
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2" align="start">
                          <div className="grid grid-cols-5 gap-1 mb-1.5">
                            {NUMBERS.map((v) => (
                              <div key={v} className="rounded-md overflow-hidden border border-border/60">
                                <button
                                  onClick={() => onEditThrow(globalIdx, v, 1)}
                                  className="w-full py-1 text-xs font-bold bg-muted text-foreground hover:bg-muted/70 active:scale-95"
                                >
                                  {v}
                                </button>
                                <div className="grid grid-cols-2 gap-px bg-border/60">
                                  <button onClick={() => onEditThrow(globalIdx, v, 3)} className="py-1 text-[10px] font-bold bg-primary/15 text-primary hover:bg-primary/30 active:scale-95">T</button>
                                  <button onClick={() => onEditThrow(globalIdx, v, 2)} className="py-1 text-[10px] font-bold bg-secondary/15 text-secondary hover:bg-secondary/30 active:scale-95">D</button>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-1 mb-1.5">
                            <button onClick={() => onEditThrow(globalIdx, 0, 1)} className="flex-1 py-1.5 rounded-md text-xs font-bold bg-accent/15 text-accent hover:bg-accent/25">{t("game.miss")}</button>
                            <button onClick={() => onEditThrow(globalIdx, 25, 1)} className="flex-1 py-1.5 rounded-md text-xs font-bold bg-accent/15 text-accent hover:bg-accent/25">{t("game.bull")}</button>
                            <button onClick={() => onEditThrow(globalIdx, 25, 2)} className="flex-1 py-1.5 rounded-md text-xs font-bold bg-accent/15 text-accent hover:bg-accent/25">{t("game.bullseye")}</button>
                          </div>
                          {/* Nothing real to delete for a hole — deleting IS what created it. */}
                          {!isHole && (
                            <Button variant="destructive" size="sm" onClick={() => onDeleteThrow(globalIdx)} className="w-full gap-1.5">
                              <X className="w-3.5 h-3.5" /> {t("game.deleteThrow")}
                            </Button>
                          )}
                        </PopoverContent>
                      </Popover>
                    ) : (
                      // Read-only view: a hole here would mean a leg finished without the
                      // correction that made it ever being resolved — shouldn't normally happen,
                      // but shown as an inert placeholder rather than the interactive-looking "+"
                      // if it ever does.
                      isHole ? <span className="inline-flex w-8 h-8 rounded-full border border-dashed border-muted-foreground/30" /> : chip
                    )}
                  </div>
                );
              })}
              {/* Completes a round that's short of 3 darts — a genuinely partial current round,
                  or one a deletion left short — instead of it staying permanently incomplete.
                  Inserts right after this round's last real dart, so a round left short by an
                  earlier deletion (with later rounds already recorded after it) re-aligns every
                  later round back to its correct 3-dart grouping as a side effect: rounds are
                  grouped purely by flat array position (see the Math.ceil(throws.length/3) above),
                  so restoring this round's own count is what puts every later dart back in the
                  round it actually belongs to. */}
              {editModeOn && onAddThrow && onOpenAddRoundChange && roundThrows.length < 3 && (
                <Popover open={openAddRoundIdx === roundIdx} onOpenChange={(open) => onOpenAddRoundChange(open ? roundIdx : null)}>
                  <PopoverTrigger asChild>
                    <button title={t("game.addThrow")} aria-label={t("game.addThrow")}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-dashed border-primary/40 text-primary hover:bg-primary/10">
                      <Plus className="w-4 h-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" align="start">
                    <div className="grid grid-cols-5 gap-1 mb-1.5">
                      {NUMBERS.map((v) => (
                        <div key={v} className="rounded-md overflow-hidden border border-border/60">
                          <button
                            onClick={() => onAddThrow(v, 1)}
                            className="w-full py-1 text-xs font-bold bg-muted text-foreground hover:bg-muted/70 active:scale-95"
                          >
                            {v}
                          </button>
                          <div className="grid grid-cols-2 gap-px bg-border/60">
                            <button onClick={() => onAddThrow(v, 3)} className="py-1 text-[10px] font-bold bg-primary/15 text-primary hover:bg-primary/30 active:scale-95">T</button>
                            <button onClick={() => onAddThrow(v, 2)} className="py-1 text-[10px] font-bold bg-secondary/15 text-secondary hover:bg-secondary/30 active:scale-95">D</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => onAddThrow(0, 1)} className="flex-1 py-1.5 rounded-md text-xs font-bold bg-accent/15 text-accent hover:bg-accent/25">{t("game.miss")}</button>
                      <button onClick={() => onAddThrow(25, 1)} className="flex-1 py-1.5 rounded-md text-xs font-bold bg-accent/15 text-accent hover:bg-accent/25">{t("game.bull")}</button>
                      <button onClick={() => onAddThrow(25, 2)} className="flex-1 py-1.5 rounded-md text-xs font-bold bg-accent/15 text-accent hover:bg-accent/25">{t("game.bullseye")}</button>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              <span className={`text-xs font-display ml-auto ${is180 ? "text-accent" : "text-muted-foreground"}`}>
                {roundComplete ? roundTotal : "..."}{is180 && " 🎯"}
                {remainingAfterRound !== undefined && (
                  <span className="text-muted-foreground/60 font-normal"> ({Math.max(0, remainingAfterRound)})</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ThrowHistoryEditor;
