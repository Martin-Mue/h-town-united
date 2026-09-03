import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wifi, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { createLegState, createCricketState } from "@/utils/gameStateFactory";
import type { GameState, PlayerSlot } from "@/types/game";
import type { Json } from "@/integrations/supabase/types";

interface PendingChallenge {
  id: string;
  player1_user_id: string;
  mode: "501" | "301" | "cricket";
  best_of_legs: number;
  challengerName: string;
  challengerEmoji: string;
}

/** "Wer hat mich herausgefordert" — polled the same 8s cadence as the rest of the app's "live"
 *  surfaces (PublicTournament.tsx, Tournament.tsx's own bracket refresh). Only ever shown once
 *  there's a real pending challenge, matching the club-activity-feed's own "no noise when empty"
 *  convention right above it on this page. */
const PendingOnlineChallenges = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [challenges, setChallenges] = useState<PendingChallenge[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      const { data: matches } = await supabase
        .from("online_matches")
        .select("id, player1_user_id, mode, best_of_legs")
        .eq("player2_user_id", user.id)
        .eq("status", "pending");
      if (cancelled || !matches || matches.length === 0) { if (!cancelled) setChallenges([]); return; }

      const challengerIds = [...new Set(matches.map((m) => m.player1_user_id))];
      const { data: challengers } = await supabase.from("players").select("user_id, name, emoji").in("user_id", challengerIds);
      if (cancelled) return;
      const byUserId = new Map((challengers ?? []).map((p) => [p.user_id, p]));
      setChallenges(
        matches.map((m) => ({
          id: m.id,
          player1_user_id: m.player1_user_id,
          mode: m.mode as PendingChallenge["mode"],
          best_of_legs: m.best_of_legs,
          challengerName: byUserId.get(m.player1_user_id)?.name ?? "?",
          challengerEmoji: byUserId.get(m.player1_user_id)?.emoji ?? "🎯",
        }))
      );
    };
    load();
    const interval = window.setInterval(load, 8000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [user]);

  const decline = async (id: string) => {
    setRespondingId(id);
    await supabase.from("online_matches").update({ status: "declined" }).eq("id", id);
    setChallenges((prev) => prev.filter((c) => c.id !== id));
    setRespondingId(null);
  };

  const accept = async (challenge: PendingChallenge) => {
    if (!user) return;
    setRespondingId(challenge.id);
    const { data: myPlayer } = await supabase.from("players").select("name").eq("user_id", user.id).maybeSingle();
    const startScore = challenge.mode === "cricket" ? 0 : Number(challenge.mode);
    // Whoever sent the challenge starts — simple, predictable default for v1 (no bull-off/manual
    // pick over a network yet, see the plan's own scope note).
    const players: PlayerSlot[] = [
      { name: challenge.challengerName, doubleOut: true, doubleIn: false, isBot: false },
      { name: myPlayer?.name ?? "?", doubleOut: true, doubleIn: false, isBot: false },
    ];
    const newGame: GameState = {
      mode: challenge.mode,
      startScore,
      bestOfLegs: challenge.best_of_legs,
      players,
      legsWon: [0, 0],
      currentLeg: createLegState(1, startScore, 0, players),
      completedLegs: [],
      currentPlayerIndex: 0,
      isFinished: false,
    };
    if (challenge.mode === "cricket") {
      newGame.cricketNumbers = undefined; // defaults applied by createCricketState below
      newGame.cricket = [createCricketState(), createCricketState()];
    }
    const { error } = await supabase.rpc("accept_online_match", {
      _match_id: challenge.id,
      _initial_game_state: { ...newGame, dartsThisRound: 0, turnStartRemaining: startScore } as unknown as Json,
    });
    setRespondingId(null);
    if (error) {
      toast({ title: t("players.challengeFailed"), description: error.message, variant: "destructive" });
      return;
    }
    navigate(`/game?online=${challenge.id}`);
  };

  if (challenges.length === 0) return null;

  return (
    <>
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-3 flex items-center gap-1.5">
        <Wifi className="w-3.5 h-3.5 text-accent" /> {t("home.pendingChallenges")}
      </h2>
      <div className="space-y-2 mb-6">
        {challenges.map((c) => (
          <div key={c.id} className="bg-card border border-border rounded-xl px-4 py-2.5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0 text-base">
              {c.challengerEmoji}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm truncate">
                <span className="font-semibold">{c.challengerName}</span> · {t("home.challengedYou")} ({c.mode === "cricket" ? "Cricket" : c.mode})
              </p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => decline(c.id)}
                disabled={respondingId === c.id}
                aria-label={t("home.declineChallenge")}
                title={t("home.declineChallenge")}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                onClick={() => accept(c)}
                disabled={respondingId === c.id}
                aria-label={t("home.acceptChallenge")}
                title={t("home.acceptChallenge")}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-40"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

export default PendingOnlineChallenges;
