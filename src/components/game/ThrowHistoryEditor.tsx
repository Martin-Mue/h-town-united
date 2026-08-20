import { Edit2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { DartThrow } from "@/utils/dartStats";

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
}

/**
 * Round-by-round throw history with two correction tools per dart: tap the chip to change its
 * VALUE in place (a compact one-tap-commits grid, same "no separate multiplier step" philosophy
 * as DartScoreInput, just smaller to fit a popover), or the small × badge to remove it outright.
 * Edit mode (the "Bearbeiten" toggle) stays on across multiple corrections in the same pass —
 * closing after every single edit meant reopening it per dart, which was the actual complaint
 * this component exists to fix.
 */
const ThrowHistoryEditor = ({ throws, playerName, editModeOn, onToggleEditMode, openChipIdx, onOpenChipChange, onEditThrow, onDeleteThrow }: ThrowHistoryEditorProps) => {
  const { t } = useLanguage();
  if (throws.length === 0) return null;

  return (
    <div className="mt-3 bg-card rounded-xl border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground uppercase font-display">{t("game.throwsHeading")} · {playerName}</p>
        <button onClick={onToggleEditMode} className="text-xs text-primary flex items-center gap-1">
          <Edit2 className="w-3 h-3" /> {editModeOn ? t("game.done") : t("game.edit")}
        </button>
      </div>
      <div className="space-y-1">
        {Array.from({ length: Math.ceil(throws.length / 3) }, (_, roundIdx) => {
          const roundThrows = throws.slice(roundIdx * 3, roundIdx * 3 + 3);
          const roundTotal = roundThrows.reduce((s, dart) => s + dart.points, 0);
          const is180 = roundTotal === 180 && roundThrows.length === 3;
          return (
            <div key={roundIdx} className={`flex items-center gap-1.5 px-2 py-1 rounded ${is180 ? "bg-accent/10 border border-accent/30" : ""}`}>
              <span className="text-[10px] text-muted-foreground w-4">{roundIdx + 1}.</span>
              {roundThrows.map((dart, i) => {
                const globalIdx = roundIdx * 3 + i;
                const chip = (
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono ${
                    dart.multiplier === 3 ? "bg-primary/20 text-primary" :
                    dart.multiplier === 2 ? "bg-secondary/20 text-secondary" : "bg-muted text-foreground"
                  }`}>
                    {dart.multiplier === 3 ? "T" : dart.multiplier === 2 ? "D" : ""}{dart.baseValue === 50 ? t("game.bull") : dart.baseValue === 0 ? t("game.miss") : dart.baseValue}
                  </span>
                );
                return (
                  <div key={globalIdx} className="relative group">
                    {editModeOn ? (
                      <Popover open={openChipIdx === globalIdx} onOpenChange={(open) => onOpenChipChange(open ? globalIdx : null)}>
                        <PopoverTrigger asChild>
                          <button title={t("game.changeValue")} aria-label={t("game.changeValue")}>{chip}</button>
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
                          <Button variant="destructive" size="sm" onClick={() => onDeleteThrow(globalIdx)} className="w-full gap-1.5">
                            <X className="w-3.5 h-3.5" /> {t("game.deleteThrow")}
                          </Button>
                        </PopoverContent>
                      </Popover>
                    ) : chip}
                    {editModeOn && (
                      <button onClick={() => onDeleteThrow(globalIdx)}
                        title={t("game.deleteThrow")} aria-label={t("game.deleteThrow")}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-destructive rounded-full flex items-center justify-center">
                        <X className="w-2.5 h-2.5 text-destructive-foreground" />
                      </button>
                    )}
                  </div>
                );
              })}
              <span className={`text-xs font-display ml-auto ${is180 ? "text-accent" : "text-muted-foreground"}`}>
                {roundThrows.length === 3 ? roundTotal : "..."}{is180 && " 🎯"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ThrowHistoryEditor;
