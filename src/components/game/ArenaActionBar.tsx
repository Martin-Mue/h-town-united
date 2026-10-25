import { Edit2, SkipForward, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ArenaActionBarProps {
  onUndo: () => void;
  undoDisabled: boolean;
  undoTitle?: string;
  undoLabel: string;
  /** Opens the throw corrector; undefined where correcting is not allowed (bot turn, online match). */
  onCorrect?: () => void;
  correctLabel: string;
  /** Ends the round early (the darts not thrown count as misses). Only offered when scoring by hand. */
  onNextPlayer?: () => void;
  nextPlayerDisabled?: boolean;
  nextPlayerLabel: string;
}

/**
 * The play screen's bottom bar: take back the last dart, correct a throw, and — when scoring by hand — hand the
 * oche over without having to tap a miss for every dart that was not thrown.
 */
const ArenaActionBar = ({ onUndo, undoDisabled, undoTitle, undoLabel, onCorrect, correctLabel, onNextPlayer, nextPlayerDisabled, nextPlayerLabel }: ArenaActionBarProps) => (
  <div className="flex shrink-0 items-center gap-2 border-t border-border/40 bg-background px-3 pt-2 landscape:pt-1" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
    <Button variant="outline" onClick={onUndo} disabled={undoDisabled} title={undoTitle} aria-label={undoLabel} className="h-12 w-12 shrink-0 p-0 landscape:h-10 landscape:w-10">
      <Undo2 className="h-5 w-5" />
    </Button>
    {onCorrect && (
      <Button variant="outline" onClick={onCorrect} aria-label={correctLabel} title={correctLabel} className="h-12 w-12 shrink-0 p-0 landscape:h-10 landscape:w-10">
        <Edit2 className="h-5 w-5" />
      </Button>
    )}
    {onNextPlayer ? (
      <Button onClick={onNextPlayer} disabled={nextPlayerDisabled} className="h-12 flex-1 gap-2 font-display text-base uppercase tracking-wide landscape:h-10">
        <SkipForward className="h-5 w-5" /> {nextPlayerLabel}
      </Button>
    ) : (
      <div className="flex-1" />
    )}
  </div>
);

export default ArenaActionBar;
