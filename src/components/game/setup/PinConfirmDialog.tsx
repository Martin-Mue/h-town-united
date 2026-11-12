import { Lock } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";

interface PinConfirmDialogProps {
  /** The member being put into a slot, or null when the dialog is closed. */
  memberName: string | null;
  value: string;
  onValueChange: (value: string) => void;
  wrong: boolean;
  checking: boolean;
  onSubmit: () => void;
  onClose: () => void;
}

/**
 * "PIN pro Spieler": confirms it's really that club member before their name lands in the slot. Purely client-side
 * (works offline, see submitPinPrompt in Game.tsx), and only shown for a player who set a PIN.
 */
const PinConfirmDialog = ({ memberName, value, onValueChange, wrong, checking, onSubmit, onClose }: PinConfirmDialogProps) => {
  const { t } = useLanguage();
  return (
    <Dialog open={memberName !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display uppercase">
            <Lock className="h-4 w-4" /> {t("game.pinPromptTitle")}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("game.pinPromptDesc").replace("{name}", memberName ?? "")}</p>
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoFocus
          value={value}
          onChange={(e) => onValueChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
          onKeyDown={(e) => { if (e.key === "Enter" && value.length === 4) onSubmit(); }}
          placeholder="••••"
          className={`w-full rounded-lg border bg-muted px-3 py-3 text-center text-2xl tracking-[0.5em] text-foreground focus:outline-none focus:ring-1 focus:ring-primary ${wrong ? "border-destructive" : "border-border"}`}
        />
        {wrong && <p className="text-center text-xs text-destructive">{t("game.pinPromptWrong")}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="h-11 flex-1" onClick={onClose}>{t("common.cancel")}</Button>
          <Button className="h-11 flex-1" disabled={value.length !== 4 || checking} onClick={onSubmit}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : t("game.pinPromptConfirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PinConfirmDialog;
