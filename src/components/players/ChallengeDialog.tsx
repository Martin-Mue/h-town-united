import { useState } from "react";
import { Wifi, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { supabase } from "@/integrations/supabase/client";

export interface ChallengeablePlayer {
  id: string;
  name: string;
  emoji: string;
  user_id?: string | null;
}

const MODES = ["501", "301", "cricket"] as const;
const BEST_OF_OPTIONS = [1, 3, 5];

/** "Online spielen" — challenge another club member to a real two-device synced match (see
 *  useOnlineMatch.ts). Only lists players with a real linked account (user_id set) — a walk-in/
 *  guest roster row has no device to challenge, same constraint the plan's own research
 *  established for why this feature can't reach every roster entry. */
const ChallengeDialog = ({ players }: { players: ChallengeablePlayer[] }) => {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { user } = useAuth();
  const { clubId } = useClubBranding();
  const [open, setOpen] = useState(false);
  const [opponentId, setOpponentId] = useState<string>("");
  const [mode, setMode] = useState<(typeof MODES)[number]>("501");
  const [bestOf, setBestOf] = useState(1);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const challengeable = players.filter((p) => p.user_id && p.user_id !== user?.id);

  const reset = () => {
    setOpponentId("");
    setMode("501");
    setBestOf(1);
    setSent(false);
  };

  const sendChallenge = async () => {
    const opponent = challengeable.find((p) => p.id === opponentId);
    if (!opponent?.user_id || !user?.id || !clubId) return;
    setSending(true);
    const { error } = await supabase.from("online_matches").insert({
      club_id: clubId,
      created_by: user.id,
      player1_user_id: user.id,
      player2_user_id: opponent.user_id,
      mode,
      best_of_legs: bestOf,
    });
    setSending(false);
    if (error) {
      toast({ title: t("players.challengeFailed"), description: error.message, variant: "destructive" });
      return;
    }
    setSent(true);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5"><Wifi className="w-4 h-4" /> {t("players.playOnline")}</Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display uppercase flex items-center gap-2"><Wifi className="w-4 h-4 text-primary" /> {t("players.playOnline")}</DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="text-center py-6 space-y-2">
            <p className="text-sm">{t("players.challengeSent")}</p>
            <p className="text-xs text-muted-foreground">{t("players.challengeSentDesc")}</p>
            <Button variant="outline" className="mt-2" onClick={() => setOpen(false)}>{t("common.close")}</Button>
          </div>
        ) : challengeable.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">{t("players.noOnlineOpponents")}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">{t("players.chooseOpponent")}</p>
              <div className="space-y-1 max-h-[35vh] overflow-y-auto -mx-1 px-1">
                {challengeable.map((p) => (
                  <label key={p.id} className={`flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer border ${opponentId === p.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/50"}`}>
                    <input type="radio" name="opponent" className="sr-only" checked={opponentId === p.id} onChange={() => setOpponentId(p.id)} />
                    <span className="text-lg shrink-0">{p.emoji}</span>
                    <span className="flex-1 min-w-0 truncate text-sm">{p.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("game.gameMode")}</p>
                <Select value={mode} onValueChange={(v) => setMode(v as (typeof MODES)[number])}>
                  <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {MODES.map((m) => <SelectItem key={m} value={m}>{m === "cricket" ? "Cricket" : m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("players.legsFormat")}</p>
                <Select value={String(bestOf)} onValueChange={(v) => setBestOf(Number(v))}>
                  <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {BEST_OF_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{t("stats.firstTo")} {Math.ceil(n / 2)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button className="w-full gap-1.5" disabled={!opponentId || sending} onClick={sendChallenge}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              {t("players.sendChallenge")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ChallengeDialog;
