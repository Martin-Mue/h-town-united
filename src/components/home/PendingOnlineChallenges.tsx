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

/** "mehr Einstellungen für Online-Spiele" (2026-09-09): who starts leg 1 — see
 *  20260909200000_add_online_match_settings.sql's own doc comment on the `starter` column. */
type StarterChoice = "challenger" | "opponent" | "random";

interface PendingChallenge {
  id: string;
  player1_user_id: string;
  mode: "501" | "301" | "cricket" | "custom";
  best_of_legs: number;
  /** Sets-Modus, only ever set for a tournament-sourced online match whose tournament has it on
   *  (see online_matches.best_of_sets's own doc comment) — null for every casual 1v1 challenge. */
  best_of_sets: number | null;
  /** X01 start score when mode === "custom" (see online_matches.custom_start_score). Null/unused
   *  for every other mode. */
  custom_start_score: number | null;
  /** Match-level (not per-player) house rules set by OnlineChallengeSetup.tsx — see
   *  online_matches.double_in/double_out's own doc comments for the pre-upgrade defaults these
   *  replace. */
  double_in: boolean;
  double_out: boolean;
  starter: StarterChoice;
  challengerName: string;
  challengerEmoji: string;
}

interface ActiveMatch {
  id: string;
  mode: "501" | "301" | "cricket" | "custom";
  custom_start_score: number | null;
  opponentName: string;
  opponentEmoji: string;
}

/** The raw `online_matches` row shape load() below needs, before challenger name/emoji get joined
 *  on from `players`. */
type PendingChallengeRow = Omit<PendingChallenge, "challengerName" | "challengerEmoji">;
type ActiveMatchRow = Omit<ActiveMatch, "opponentName" | "opponentEmoji">;

/** Shared label for both the pending-challenge and active-match rows below — "custom" alone isn't
 *  meaningful to a player, so it's shown with its actual start score (e.g. "Custom 701"). */
const modeLabel = (t: (key: string) => string, mode: "501" | "301" | "cricket" | "custom", customStartScore: number | null) =>
  mode === "cricket" ? "Cricket" : mode === "custom" ? `${t("game.custom")} ${customStartScore ?? ""}`.trim() : mode;

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
      // "mehr Einstellungen für Online-Spiele" (2026-09-09): the new columns/select below can 400
      // if this device is on an older PostgREST schema cache than the just-added migration (same
      // class of break the league-creation bug hit earlier this session) — falling back to the
      // pre-upgrade column list, with the pre-upgrade hardcoded values filled in, keeps pending
      // challenges/active matches showing up either way instead of silently going blank.
      let pending: PendingChallengeRow[] | null = null;
      {
        const { data, error } = await supabase
          .from("online_matches")
          .select("id, player1_user_id, mode, best_of_legs, best_of_sets, custom_start_score, double_in, double_out, starter")
          .eq("player2_user_id", user.id)
          .eq("status", "pending");
        if (!error) {
          pending = (data ?? []) as typeof pending;
        } else {
          const fallback = await supabase
            .from("online_matches")
            .select("id, player1_user_id, mode, best_of_legs, best_of_sets")
            .eq("player2_user_id", user.id)
            .eq("status", "pending");
          pending = (fallback.data ?? []).map((m) => ({
            ...m,
            mode: m.mode as PendingChallenge["mode"],
            custom_start_score: null,
            double_in: false,
            double_out: true,
            starter: "challenger" as const,
          }));
        }
      }
      // Matches already accepted — the challenger's own device has no other way to learn "the
      // other side said yes, come play" than polling for this, since OnlineChallengeSetup.tsx never
      // navigates them into Game.tsx itself (only the accepter's own accept() action does that).
      let active: (ActiveMatchRow & { player1_user_id: string; player2_user_id: string })[] | null = null;
      {
        const { data, error } = await supabase
          .from("online_matches")
          .select("id, mode, player1_user_id, player2_user_id, custom_start_score")
          .eq("status", "active")
          .or(`player1_user_id.eq.${user.id},player2_user_id.eq.${user.id}`);
        if (!error) {
          active = (data ?? []) as typeof active;
        } else {
          const fallback = await supabase
            .from("online_matches")
            .select("id, mode, player1_user_id, player2_user_id")
            .eq("status", "active")
            .or(`player1_user_id.eq.${user.id},player2_user_id.eq.${user.id}`);
          active = (fallback.data ?? []).map((m) => ({ ...m, mode: m.mode as ActiveMatch["mode"], custom_start_score: null }));
        }
      }
      if (cancelled) return;

      const challengerIds = [...new Set((pending ?? []).map((m) => m.player1_user_id))];
      const opponentIds = [...new Set((active ?? []).map((m) => (m.player1_user_id === user.id ? m.player2_user_id : m.player1_user_id)))];
      const { data: playerRows } = await supabase.from("players").select("user_id, name, emoji").in("user_id", [...new Set([...challengerIds, ...opponentIds])]);
      if (cancelled) return;
      const byUserId = new Map((playerRows ?? []).map((p) => [p.user_id, p]));

      setChallenges(
        (pending ?? []).map((m) => ({
          ...m,
          challengerName: byUserId.get(m.player1_user_id)?.name ?? "?",
          challengerEmoji: byUserId.get(m.player1_user_id)?.emoji ?? "🎯",
        }))
      );
      setActiveMatches(
        (active ?? []).map((m) => {
          const opponentId = m.player1_user_id === user.id ? m.player2_user_id : m.player1_user_id;
          return {
            id: m.id,
            mode: m.mode,
            custom_start_score: m.custom_start_score,
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
    const startScore = challenge.mode === "cricket" ? 0 : challenge.mode === "custom" ? (challenge.custom_start_score ?? 501) : Number(challenge.mode);
    // "mehr Einstellungen für Online-Spiele" (2026-09-09): who starts leg 1 is now the challenger's
    // own choice (see online_matches.starter's doc comment) instead of always slot 0. 'random' is
    // resolved right here, at accept-time — the first moment both players are actually represented,
    // same reasoning as this app's other casual/low-stakes randomness (bot-fill, Elo close-match).
    const starterSlot = challenge.starter === "opponent" ? 1 : challenge.starter === "random" ? (Math.random() < 0.5 ? 0 : 1) : 0;
    const players: PlayerSlot[] = [
      { name: challenge.challengerName, doubleOut: challenge.double_out, doubleIn: challenge.double_in, isBot: false },
      { name: myPlayer?.name ?? "?", doubleOut: challenge.double_out, doubleIn: challenge.double_in, isBot: false },
    ];
    const newGame: GameState = {
      mode: challenge.mode,
      startScore,
      bestOfLegs: challenge.best_of_legs,
      players,
      legsWon: [0, 0],
      currentLeg: createLegState(1, startScore, starterSlot, players),
      completedLegs: [],
      currentPlayerIndex: starterSlot,
      isFinished: false,
      // Sets-Modus: only ever set here for a tournament-sourced challenge whose tournament has it
      // on (see PendingChallenge.best_of_sets's own doc comment) — null/undefined for every casual
      // 1v1 challenge, same reuse-bestOfLegs-as-legs-per-set convention as everywhere else (see
      // GameState.setsMode's own doc comment in types/game.ts).
      ...(challenge.mode !== "cricket" && challenge.best_of_sets
        ? { setsMode: { bestOfSets: challenge.best_of_sets }, setsWon: [0, 0] }
        : {}),
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
                <span className="font-semibold">{t("home.matchWith")} {m.opponentName}</span> · {modeLabel(t, m.mode, m.custom_start_score)}
              </p>
            </div>
            <span className="text-xs font-display uppercase text-primary shrink-0">{t("home.joinMatch")}</span>
          </Link>
        ))}
        {challenges.map((c) => (
          <div key={c.id} className="gradient-card border border-border shadow-elevation-sm rounded-xl px-4 py-2.5">
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
                    <span className="font-semibold">{c.challengerName}</span> · {t("home.challengedYou")} ({modeLabel(t, c.mode, c.custom_start_score)})
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
