import { useState } from "react";
import { Undo2, Camera, Keyboard, Volume2, VolumeX, RotateCcw, MoreHorizontal, Sparkles, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Drawer, DrawerContent, DrawerTitle, DrawerClose } from "@/components/ui/drawer";
import { useLanguage } from "@/contexts/LanguageContext";

interface GameControlBarProps {
  onUndo: () => void;
  undoDisabled: boolean;
  undoTitle?: string;
  /** Scoring source switch (Tippen / Kamera). Omitted entirely when the source is fixed for the
   *  whole game (Autodarts), since there is nothing to switch. */
  scoring?: {
    cameraEnabled: boolean;
    cameraDisabled: boolean;
    onSelectManual: () => void;
    onSelectCamera: () => void;
  };
  soundEnabled: boolean;
  onToggleSound: () => void;
  onCancelGame: () => void;
  /** Only passed while the live commentator is actually offered (camera on + plan includes it). */
  aiCommentary?: { enabled: boolean; onToggle: () => void };
  /** Undefined while correcting isn't allowed (bot turn, online match). */
  onOpenCorrector?: () => void;
}

/**
 * The play screen's one slim control strip: Undo and the scoring-source switch stay one tap away,
 * everything else (sound, commentator, throw correction, cancel) lives in the sheet behind "⋯".
 * Replaces two near-identical 4-5 button toolbars that each repeated the same icons next to the
 * scoreboard and made it compete with them for width.
 */
const GameControlBar = ({ onUndo, undoDisabled, undoTitle, scoring, soundEnabled, onToggleSound, onCancelGame, aiCommentary, onOpenCorrector }: GameControlBarProps) => {
  const { t } = useLanguage();
  const [sheetOpen, setSheetOpen] = useState(false);

  const rowClass = "w-full flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-left text-sm hover:bg-muted transition-colors";

  return (
    <div className="shrink-0 bg-background px-4 pt-2 pb-2 flex items-center gap-2 border-b border-border/40">
      <Button variant="outline" onClick={onUndo} disabled={undoDisabled} title={undoTitle} className="flex-1 gap-1.5 h-11">
        <Undo2 className="w-4 h-4" /> {t("game.undo")}
      </Button>

      {scoring && (
        <div className="flex rounded-lg border border-border p-0.5 h-11 shrink-0" role="group">
          <button
            type="button"
            onClick={scoring.onSelectManual}
            aria-pressed={!scoring.cameraEnabled}
            aria-label={t("game.manualEntry")}
            className={`px-3 rounded-md transition-colors ${!scoring.cameraEnabled ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            <Keyboard className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={scoring.onSelectCamera}
            disabled={scoring.cameraDisabled}
            aria-pressed={scoring.cameraEnabled}
            aria-label={t("game.liveCameraScoring")}
            className={`px-3 rounded-md transition-colors disabled:opacity-40 ${scoring.cameraEnabled ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            <Camera className="w-4 h-4" />
          </button>
        </div>
      )}

      <Button variant="outline" onClick={() => setSheetOpen(true)} className="h-11 px-3 shrink-0" aria-label={t("nav.more")}>
        <MoreHorizontal className="w-5 h-5" />
      </Button>

      <Drawer open={sheetOpen} onOpenChange={setSheetOpen} shouldScaleBackground={false}>
        <DrawerContent>
          <DrawerTitle className="px-4 pt-1 text-sm uppercase tracking-widest text-muted-foreground font-display">
            {t("nav.more")}
          </DrawerTitle>
          <div className="p-4 space-y-2" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
            <button type="button" className={rowClass} onClick={onToggleSound}>
              <span className="flex items-center gap-2">
                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                {soundEnabled ? t("game.soundOff") : t("game.soundOn")}
              </span>
              <Switch checked={soundEnabled} tabIndex={-1} className="pointer-events-none" />
            </button>

            {aiCommentary && (
              <button type="button" className={rowClass} onClick={aiCommentary.onToggle}>
                <span className="flex items-center gap-2"><Sparkles className="w-4 h-4" /> {t("game.aiCommentaryToggle")}</span>
                <Switch checked={aiCommentary.enabled} tabIndex={-1} className="pointer-events-none" />
              </button>
            )}

            {onOpenCorrector && (
              <DrawerClose asChild>
                <button type="button" className={rowClass} onClick={onOpenCorrector}>
                  <span className="flex items-center gap-2"><Edit2 className="w-4 h-4" /> {t("game.correctThrowsTitle")}</span>
                </button>
              </DrawerClose>
            )}

            <DrawerClose asChild>
              <button type="button" className={`${rowClass} text-destructive border-destructive/30`} onClick={onCancelGame}>
                <span className="flex items-center gap-2"><RotateCcw className="w-4 h-4" /> {t("game.cancelGame")}</span>
              </button>
            </DrawerClose>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
};

export default GameControlBar;
