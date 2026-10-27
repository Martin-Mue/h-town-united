import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Swords, Check, X, Play, Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { usePlayers } from "@/hooks/usePlayers";
import { loadMyDuels, duelOutcome, type OnlineDuel } from "@/lib/onlineDuels";
import { notifyDuelDeclined } from "@/lib/onlineMatchNotify";

const modeLabel = (t: (k: string) => string, d: OnlineDuel) =>
  d.mode === "custom" ? `${t("game.custom")} ${d.custom_start_score ?? ""}`.trim() : d.mode;

/** Fernduelle (asynchronous): invitations, "your turn to play", waiting, and recent results.
 *  Polled like the rest of the home page's online cards; hidden when empty. */
const PendingOnlineDuels = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const { data: players = [] } = usePlayers();
  const [duels, setDuels] = useState<OnlineDuel[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const load = useCallback(async () => { if (user) setDuels(await loadMyDuels()); }, [user]);
  useEffect(() => {
    void load();
    const interval = window.setInterval(load, 15000);
    return () => window.clearInterval(interval);
  }, [load]);

  const nameOf = (uid: string) => players.find((p) => p.user_id === uid);
  if (!user) return null;

  const respond = async (d: OnlineDuel, accept: boolean) => {
    setBusy(d.id);
    const { error } = await supabase.rpc("respond_online_duel", { _id: d.id, _accept: accept, _reason: comment.trim() || undefined });
    setBusy(null);
    if (error) { toast({ title: t("players.challengeFailed"), description: error.message, variant: "destructive" }); return; }
    if (!accept) notifyDuelDeclined(d.challenger_user_id, nameOf(user.id)?.name ?? "Jemand", comment.trim() || undefined);
    setDeclining(null);
    setComment("");
    await load();
  };
  const withdraw = async (d: OnlineDuel) => {
    setBusy(d.id);
    await supabase.rpc("cancel_online_duel", { _id: d.id });
    setBusy(null);
    await load();
  };

  // Finished/forfeited duels stay visible for three days, open ones until they expire.
  const threeDaysAgo = Date.now() - 3 * 24 * 3600 * 1000;
  const visible = duels.filter((d) => {
    if (d.status === "declined" || d.status === "canceled") return false;
    if (d.status === "finished") return new Date(d.created_at).getTime() > threeDaysAgo;
    if (d.expired) return d.status === "active" && new Date(d.expires_at).getTime() > threeDaysAgo && (d.my_finished !== d.their_finished);
    return true;
  });
  if (visible.length === 0) return null;

  const fmtDarts = (n: number | null) => (n === null ? "?" : String(n));

  return (
    <>
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-3 flex items-center gap-1.5">
        <Swords className="w-3.5 h-3.5 text-accent" /> {t("home.duels")}
      </h2>
      <div className="space-y-2 mb-6">
        {visible.map((d) => {
          const iAmChallenger = d.challenger_user_id === user.id;
          const other = nameOf(iAmChallenger ? d.opponent_user_id : d.challenger_user_id);
          const outcome = duelOutcome(d, user.id);
          const daysLeft = Math.max(0, Math.ceil((new Date(d.expires_at).getTime() - Date.now()) / 86400000));
          return (
            <div key={d.id} className="gradient-card border border-border shadow-elevation-sm rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-xl shrink-0">{other?.emoji ?? "🎯"}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">
                    {other?.name ?? "?"} <span className="font-normal text-muted-foreground">· {t("home.duelLabel")} {modeLabel(t, d)}</span>
                  </p>
                  {outcome ? (
                    <p className={`text-xs ${outcome === "won" || outcome === "forfeit-won" ? "text-primary" : outcome === "draw" ? "text-muted-foreground" : "text-destructive"}`}>
                      {outcome === "draw" ? t("home.duelDraw") : outcome === "won" || outcome === "forfeit-won" ? t("home.duelWon") : t("home.duelLost")}
                      {d.status === "finished" && ` · ${fmtDarts(d.my_darts)} ${t("home.duelDarts")} – ${fmtDarts(d.their_darts)}`}
                      {outcome.startsWith("forfeit") && ` · ${t("home.duelForfeit")}`}
                    </p>
                  ) : d.status === "active" && d.my_finished ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Hourglass className="w-3 h-3" /> {t("home.duelWaitingFor").replace("{name}", other?.name ?? "?")} · {fmtDarts(d.my_darts)} {t("home.duelDarts")}
                    </p>
                  ) : d.status === "active" ? (
                    <p className="text-xs text-primary">{t("home.duelYourTurn")} · {daysLeft} {t("home.duelDaysLeft")}</p>
                  ) : d.status === "pending" && !iAmChallenger ? (
                    <p className="text-xs text-muted-foreground">{t("home.duelInvited")}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Hourglass className="w-3 h-3" /> {t("home.duelPending")}</p>
                  )}
                </div>
                {d.status === "active" && !d.my_finished && !d.expired && (
                  <Button asChild size="sm" className="gap-1 shrink-0">
                    <Link to={`/game?duel=${d.id}`}><Play className="w-3.5 h-3.5" /> {t("home.duelPlay")}</Link>
                  </Button>
                )}
                {d.status === "pending" && !iAmChallenger && declining !== d.id && (
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => setDeclining(d.id)} disabled={busy === d.id} aria-label={t("home.declineChallenge")} className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/15 hover:text-destructive disabled:opacity-40"><X className="w-4 h-4" /></button>
                    <button onClick={() => respond(d, true)} disabled={busy === d.id} aria-label={t("home.acceptChallenge")} className="w-8 h-8 rounded-full flex items-center justify-center bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-40"><Check className="w-4 h-4" /></button>
                  </div>
                )}
                {iAmChallenger && (d.status === "pending" || (d.status === "active" && !d.my_finished && !d.their_finished)) && (
                  <button onClick={() => withdraw(d)} disabled={busy === d.id} className="text-xs text-muted-foreground hover:text-destructive shrink-0">{t("home.doublesWithdraw")}</button>
                )}
              </div>
              {declining === d.id && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    autoFocus
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={200}
                    placeholder={t("home.declineCommentPlaceholder")}
                    onKeyDown={(e) => { if (e.key === "Enter") void respond(d, false); }}
                    className="flex-1 min-w-0 rounded-lg bg-muted border border-border px-3 py-1.5 text-sm text-foreground"
                  />
                  <Button size="sm" variant="ghost" onClick={() => { setDeclining(null); setComment(""); }}>{t("common.cancel")}</Button>
                  <Button size="sm" variant="destructive" disabled={busy === d.id} onClick={() => respond(d, false)}>{t("home.declineChallenge")}</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default PendingOnlineDuels;
