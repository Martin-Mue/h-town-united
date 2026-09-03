import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Wifi, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { supabase } from "@/integrations/supabase/client";
import { fetchClubPlayers, type ClubPlayer } from "@/lib/repositories/players";

const MODES = ["501", "301", "cricket"] as const;
const BEST_OF_OPTIONS = [1, 3, 5];

/** The "online" half of Game.tsx's plain-game setup toggle — challenge a real club member to a
 *  synced two-device match instead of entering local names. Moved here from a standalone dialog
 *  on Players.tsx (2026-09-04): starting/requesting a game belongs where every other way to start
 *  a game already lives, not on the member roster. */
const OnlineChallengeSetup = ({ onBack }: { onBack: () => void }) => {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { user } = useAuth();
  const { clubId } = useClubBranding();
  const navigate = useNavigate();
  const [players, setPlayers] = useState<ClubPlayer[]>([]);
  const [opponentId, setOpponentId] = useState<string>("");
  const [mode, setMode] = useState<(typeof MODES)[number]>("501");
  const [bestOf, setBestOf] = useState(1);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetchClubPlayers().then(setPlayers).catch(() => setPlayers([]));
  }, []);

  const challengeable = players.filter((p) => p.user_id && p.user_id !== user?.id);

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
    toast({ title: t("players.challengeSent"), description: t("players.challengeSentDesc") });
    navigate("/");
  };

  return (
    <div className="container py-6 animate-slide-up max-w-lg mx-auto">
      <Button variant="ghost" onClick={onBack} className="mb-4 text-muted-foreground -ml-2">
        <ArrowLeft className="w-4 h-4 mr-1" /> {t("common.back")}
      </Button>
      <div className="text-center mb-6">
        <Wifi className="w-10 h-10 text-primary mx-auto mb-2" />
        <h2 className="text-2xl font-display uppercase">{t("players.playOnline")}</h2>
      </div>

      {challengeable.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t("players.noOnlineOpponents")}</p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">{t("players.chooseOpponent")}</p>
            <div className="space-y-1 max-h-[40vh] overflow-y-auto -mx-1 px-1">
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
                <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {MODES.map((m) => <SelectItem key={m} value={m}>{m === "cricket" ? "Cricket" : m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("players.legsFormat")}</p>
              <Select value={String(bestOf)} onValueChange={(v) => setBestOf(Number(v))}>
                <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {BEST_OF_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{t("stats.firstTo")} {Math.ceil(n / 2)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button className="w-full gap-1.5 font-display uppercase" disabled={!opponentId || sending} onClick={sendChallenge}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            {t("players.sendChallenge")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default OnlineChallengeSetup;
