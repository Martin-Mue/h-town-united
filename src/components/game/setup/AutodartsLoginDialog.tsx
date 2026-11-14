import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { confirmAutodartsPlayerLogin } from "@/lib/autodartsClient";

interface AutodartsLoginDialogProps {
  /** The player confirming their login, or null when the dialog is closed. */
  playerName: string | null;
  onConfirmed: (login: { loginId: string; username: string | null }) => void;
  onClose: () => void;
}

/**
 * A fellow player signs in with their OWN Autodarts account on this device, for this match only --
 * the same thing Autodarts itself asks for when a second registered player joins at one board.
 * The password goes straight to Autodarts' login and is never stored.
 */
const AutodartsLoginDialog = ({ playerName, onConfirmed, onClose }: AutodartsLoginDialogProps) => {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (playerName !== null) { setEmail(""); setPassword(""); setError(null); setBusy(false); }
  }, [playerName]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const login = await confirmAutodartsPlayerLogin(email.trim(), password);
      setPassword("");
      onConfirmed(login);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("autodarts.linkFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={playerName !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display uppercase">
            <Target className="h-4 w-4" /> {t("autodarts.loginDialogTitle").replace("{name}", playerName ?? "")}
          </DialogTitle>
          <DialogDescription>{t("autodarts.loginDialogDesc").replace(/\{name\}/g, playerName ?? "")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); if (email.trim() && password && !busy) void submit(); }}>
          <Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder={t("autodarts.email")} aria-label={t("autodarts.email")} className="h-11 rounded-xl text-base" />
          <Input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder={t("autodarts.password")} aria-label={t("autodarts.password")} className="h-11 rounded-xl text-base" />
          {error && <p className="text-[13px] text-destructive">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="h-11 flex-1" disabled={busy} onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" className="h-11 flex-1 gap-1.5" disabled={busy || !email.trim() || !password}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("autodarts.loginButton")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AutodartsLoginDialog;
