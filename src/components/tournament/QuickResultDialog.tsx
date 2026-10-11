import { useState, type ReactNode } from "react";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";

interface QuickResultDialogProps {
  player1: string;
  player2: string;
  /** Legs (or sets) needed to win the match — ceil(bestOf / 2). */
  firstTo: number;
  onSubmit: (winner: string, score1: number, score2: number) => void | Promise<void>;
  trigger?: ReactNode;
}

/**
 * One-tap result entry for matches played outside the app (e.g. scored in DartsMind or on a paper
 * sheet): pick the winner and the final score in a single tap instead of tapping "+1 leg" once per
 * leg and then the winner. Offers every legal final score for a first-to-N match.
 */
const QuickResultDialog = ({ player1, player2, firstTo, onSubmit, trigger }: QuickResultDialogProps) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const losing = Array.from({ length: Math.max(1, firstTo) }, (_, i) => i);

  const submit = async (winner: string, s1: number, s2: number) => {
    setBusy(true);
    try { await onSubmit(winner, s1, s2); setOpen(false); } finally { setBusy(false); }
  };

  const side = (name: string, isFirst: boolean) => (
    <div>
      <p className="text-sm font-display uppercase break-words mb-2">
        {name} <span className="text-muted-foreground normal-case font-sans text-xs">{t("tournament.quickResultWins")}</span>
      </p>
      <div className="grid grid-cols-4 gap-2">
        {losing.map((l) => (
          <Button
            key={l}
            variant="outline"
            className="h-12 font-display text-base tabular-nums"
            disabled={busy}
            onClick={() => submit(name, isFirst ? firstTo : l, isFirst ? l : firstTo)}
          >
            {isFirst ? `${firstTo}:${l}` : `${l}:${firstTo}`}
          </Button>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="h-9 text-xs gap-1.5 shrink-0">
            <ClipboardCheck className="w-3.5 h-3.5" /> {t("tournament.quickResult")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t("tournament.quickResult")}</DialogTitle>
          <DialogDescription>{t("tournament.quickResultDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {side(player1, true)}
          {side(player2, false)}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QuickResultDialog;
