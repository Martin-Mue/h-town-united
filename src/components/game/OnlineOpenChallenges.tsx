import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Megaphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { usePlayers } from "@/hooks/usePlayers";
import { useOnlineUserIds } from "@/lib/clubPresence";
import { createLegState, createCricketState } from "@/utils/gameStateFactory";
import type { GameState, PlayerSlot } from "@/types/game";
import type { Json } from "@/integrations/supabase/types";

interface OpenChallenge {
  id: string;
  created_by: string;
  mode: "501" | "301" | "cricket" | "custom";
  best_of_legs: number;
  double_in: boolean;
  double_out: boolean;
  custom_start_score: number | null;
}

const modeLabel = (t: (k: string) => string, c: Pick<OpenChallenge, "mode" | "custom_start_score">) =>
  c.mode === "cricket" ? "Cricket" : c.mode === "custom" ? `${t("game.custom")} ${c.custom_start_score ?? ""}`.trim() : c.mode;

interface Props {
  /** The settings currently picked on the surrounding setup form — what "Offen ausschreiben" posts. */
  draft: { mode: OpenChallenge["mode"]; bestOf: number; doubleIn: boolean; doubleOut: boolean; customStartScore: number };
}

/** "Ich suche einen Gegner": members post a challenge anyone in the club can take. Lives on the
 *  online-setup screen. Taking one creates a normal pending 1:1 match server-side
 *  (take_open_challenge) which this device then accepts at once — same initial state a direct
 *  challenge accept builds in PendingOnlineChallenges.tsx. */
const OnlineOpenChallenges = ({ draft }: Props) => {
  const { user } = useAuth();
  const { clubId } = useClubBranding();
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: players = [] } = usePlayers();
  const onlineNow = useOnlineUserIds();
  const [open, setOpen] = useState<OpenChallenge[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!clubId) return;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from("online_open_challenges")
      .select("id, created_by, mode, best_of_legs, double_in, double_out, custom_start_score")
      .eq("club_id", clubId).eq("status", "open").gte("created_at", since)
      .order("created_at", { ascending: false });
    setOpen((data ?? []) as OpenChallenge[]);
  }, [clubId]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(load, 8000);
    return () => window.clearInterval(interval);
  }, [load]);

  const nameOf = (uid: string) => players.find((p) => p.user_id === uid);
  const mine = open.find((c) => c.created_by === user?.id);
  const others = open.filter((c) => c.created_by !== user?.id);

  const post = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("create_open_challenge", {
      _mode: draft.mode, _best_of_legs: draft.bestOf,
      _double_in: draft.mode === "cricket" ? false : draft.doubleIn,
      _double_out: draft.mode === "cricket" ? true : draft.doubleOut,
      _custom_start_score: (draft.mode === "custom" ? draft.customStartScore : null) as unknown as number,
    });
    setBusy(false);
    if (error) { toast({ title: t("players.challengeFailed"), description: error.message, variant: "destructive" }); return; }
    toast({ title: t("players.openChallengePosted") });
    await load();
  };

  const withdraw = async (id: string) => {
    setBusy(true);
    await supabase.rpc("cancel_open_challenge", { _id: id });
    setBusy(false);
    await load();
  };

  const take = async (c: OpenChallenge) => {
    if (!user) return;
    setBusy(true);
    const { data: matchId, error } = await supabase.rpc("take_open_challenge", { _id: c.id });
    if (error || !matchId) {
      setBusy(false);
      toast({ title: t("players.challengeFailed"), description: error?.message, variant: "destructive" });
      await load();
      return;
    }
    const startScore = c.mode === "cricket" ? 0 : c.mode === "custom" ? (c.custom_start_score ?? 501) : Number(c.mode);
    const starterSlot = Math.random() < 0.5 ? 0 : 1;
    const slots: PlayerSlot[] = [nameOf(c.created_by)?.name ?? "?", nameOf(user.id)?.name ?? "?"].map((name) => ({
      name, doubleOut: c.double_out, doubleIn: c.double_in, isBot: false,
    }));
    const game: GameState = {
      mode: c.mode, startScore, bestOfLegs: c.best_of_legs, players: slots, legsWon: [0, 0],
      currentLeg: createLegState(1, startScore, starterSlot, slots), completedLegs: [],
      currentPlayerIndex: starterSlot, isFinished: false,
    };
    if (c.mode === "cricket") game.cricket = [createCricketState(), createCricketState()];
    const { error: acceptError } = await supabase.rpc("accept_online_match", {
      _match_id: matchId as string,
      _initial_game_state: { ...game, dartsThisRound: 0, turnStartRemaining: startScore } as unknown as Json,
    });
    setBusy(false);
    if (acceptError) { toast({ title: t("players.challengeFailed"), description: acceptError.message, variant: "destructive" }); return; }
    navigate(`/game?online=${matchId}`);
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-3">
      <p className="text-xs text-muted-foreground uppercase font-display flex items-center gap-1.5">
        <Megaphone className="w-3.5 h-3.5 text-accent" /> {t("players.openChallenges")}
      </p>

      {others.length === 0 && !mine && <p className="text-xs text-muted-foreground">{t("players.noOpenChallenges")}</p>}

      {others.map((c) => {
        const who = nameOf(c.created_by);
        return (
          <div key={c.id} className="flex items-center gap-2">
            <span className="text-lg shrink-0">{who?.emoji ?? "🎯"}</span>
            <span className="flex-1 min-w-0 text-sm truncate">
              {who?.name ?? "?"}{onlineNow.has(c.created_by) && <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-emerald-500 align-middle" />}
              <span className="text-xs text-muted-foreground"> · {modeLabel(t, c)} · {t("stats.firstTo")} {Math.ceil(c.best_of_legs / 2)}</span>
            </span>
            <Button size="sm" disabled={busy} onClick={() => take(c)}>{t("players.takeChallenge")}</Button>
          </div>
        );
      })}

      {mine ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-xs text-primary">{t("players.yourOpenChallenge")} · {modeLabel(t, mine)}</p>
          <button type="button" disabled={busy} onClick={() => withdraw(mine.id)} aria-label={t("common.cancel")} className="text-muted-foreground hover:text-destructive">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-full gap-1.5" disabled={busy} onClick={post}>
          <Megaphone className="w-3.5 h-3.5" /> {t("players.postOpenChallenge")}
        </Button>
      )}
    </div>
  );
};

export default OnlineOpenChallenges;
