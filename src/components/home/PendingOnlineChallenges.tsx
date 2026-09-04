import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Wifi, Check, X, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { createLegState, createCricketState } from "@/utils/gameStateFactory";
import { notifyChallengeDeclined } from "@/lib/onlineMatchNotify";
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

interface ActiveMatch {
  id: string;
  mode: "501" | "301" | "cricket";
  opponentName: string;
  opponentEmoji: string;
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
  const [activeMatches, setActiveMatches] = useState<ActiveMatch[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  // Tapping decline doesn't decline immediately — it reveals an inline optional-comment field
  // first (the user explicitly wanted the challenger to be able to see why), confirmed via the
  // same X icon a second time. null means no challenge is mid-decline right now.
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineComment, setDeclineComment] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      const { data: pending } = await supabase
        .from("online_matches")
        .select("id, player1_user_id, mode, best_of_legs")
        .eq("player2_user_id", user.id)
        .eq("status", "pending");
      // Matches already accepted — the challenger's own device has no other way to learn "the
      // other side said yes, come play" than polling for this, since OnlineChallengeSetup.tsx never
      // navigates them into Game.tsx itself (only the accepter's own accept() action does that).
      const { data: active } = await supabase
        .from("online_matches")
        .select("id, mode, player1_user_id, player2_user_id")
        .eq("status", "active")
        .or(`player1_user_id.eq.${user.id},player2_user_id.eq.${user.id}`);
      if (cancelled) return;

      const challengerIds = [...new Set((pending ?? []).map((m) => m.player1_user_id))];
      const opponentIds = [...new Set((active ?? []).map((m) => (m.player1_user_id === user.id ? m.player2_user_id : m.player1_user_id)))];
      const { data: playerRows } = await supabase.from("players").select("user_id, name, emoji").in("user_id", [...new Set([...challengerIds, ...opponentIds])]);
      if (cancelled) return;
      const byUserId = new Map((playerRows ?? []).map((p) => [p.user_id, p]));

      setChallenges(
        (pending ?? []).map((m) => ({
          id: m.id,
          player1_user_id: m.player1_user_id,
          mode: m.mode as PendingChallenge["mode"],
          best_of_legs: m.best_of_legs,
          challengerName: byUserId.get(m.player1_user_id)?.name ?? "?",
          challengerEmoji: byUserId.get(m.player1_user_id)?.emoji ?? "🎯",
        }))
      );
      setActiveMatches(
        (active ?? []).map((m) => {
          const opponentId = m.player1_user_id === user.id ? m.player2_user_id : m.player1_user_id;
          return {
            id: m.id,
            mode: m.mode as ActiveMatch["mode"],
            opponentName: byUserId.get(opponentId)?.name ?? "?",
            opponentEmoji: byUserId.get(opponentId)?.emoji ?? "🎯",
          };
        })
      );
    };
    load();
    const interval = window.setInterval(load, 8000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [user]);

  const decline = async (challenge: PendingChallenge, reason: string) => {
    if (!user) return;
    setRespondingId(challenge.id);
    const trimmedReason = reason.trim();
    const { error } = await supabase.from("online_matches")
      .update({ status: "declined", decline_reason: trimmedReason || null })
      .eq("id", challenge.id);
    // If a given environment hasn't had the decline_reason migration applied yet, PostgREST
    // rejects the whole update — declining must still work even without the comment persisted
    // (the push below still carries it either way, computed client-side regardless of this write).
    if (error) {
      await supabase.from("online_matches").update({ status: "declined" }).eq("id", challenge.id);
    }
    const { data: myPlayer } = await supabase.from("players").select("name").eq("user_id", user.id).maybeSingle();
    notifyChallengeDeclined(challenge.player1_user_id, myPlayer?.name ?? "Jemand", trimmedReason || undefined);
    setChallenges((prev) => prev.filter((c) => c.id !== challenge.id));
    setRespondingId(null);
    setDecliningId(null);
    setDeclineComment("");
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

  if (challenges.length === 0 && activeMatches.length === 0) return null;

  return (
    <>
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-3 flex items-center gap-1.5">
        <Wifi className="w-3.5 h-3.5 text-accent" /> {t("home.pendingChallenges")}
      </h2>
      <div className="space-y-2 mb-6">
        {activeMatches.map((m) => (
          <Link key={m.id} to={`/game?online=${m.id}`} className="bg-card border border-primary/40 rounded-xl px-4 py-2.5 flex items-center gap-3 hover:border-primary transition-colors">
            <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0 text-base">
              {m.opponentEmoji}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm truncate">
                <span className="font-semibold">{t("home.matchWith")} {m.opponentName}</span> · {m.mode === "cricket" ? "Cricket" : m.mode}
              </p>
            </div>
            <span className="text-xs font-display uppercase text-primary shrink-0">{t("home.joinMatch")}</span>
          </Link>
        ))}
        {challenges.map((c) => (
          <div key={c.id} className="bg-card border border-border rounded-xl px-4 py-2.5">
            {decliningId === c.id ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={declineComment}
                  onChange={(e) => setDeclineComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") decline(c, declineComment); }}
                  placeholder={t("home.declineCommentPlaceholder")}
                  maxLength={200}
                  className="flex-1 min-w-0 rounded-lg bg-muted border border-border px-3 py-1.5 text-sm text-foreground"
                />
                <button
                  onClick={() => { setDecliningId(null); setDeclineComment(""); }}
                  disabled={respondingId === c.id}
                  aria-label={t("common.cancel")}
                  title={t("common.cancel")}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors shrink-0 disabled:opacity-40"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  onClick={() => decline(c, declineComment)}
                  disabled={respondingId === c.id}
                  aria-label={t("home.declineChallenge")}
                  title={t("home.declineChallenge")}
                  className="w-8 h-8 rounded-full flex items-center justify-center bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors shrink-0 disabled:opacity-40"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
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
                    onClick={() => setDecliningId(c.id)}
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
            )}
          </div>
        ))}
      </div>
    </>
  );
};

export default PendingOnlineChallenges;
