import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Users, Check, X, Hourglass, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { loadDoublesSeats, respondToDoubles, teamOfSlot, defaultTeamName, type DoublesSeat, type DoublesMatchSettings } from "@/lib/onlineDoubles";
import { notifyDoublesDeclined, notifyDoublesStarted } from "@/lib/onlineMatchNotify";

interface DoublesMatch {
  id: string;
  status: "pending" | "active";
  created_by: string;
  mode: DoublesMatchSettings["mode"];
  settings: DoublesMatchSettings;
  teamNames: [string, string] | null;
  seats: DoublesSeat[];
}

const modeLabel = (t: (k: string) => string, s: DoublesMatchSettings) =>
  s.mode === "cricket" ? "Cricket" : s.mode === "custom" ? `${t("game.custom")} ${s.customStartScore ?? ""}`.trim() : s.mode;

const STATUS_ICON = { accepted: Check, invited: Hourglass, declined: X } as const;

/** Online-Doppel auf der Startseite: Einladungen (zu-/absagen), die Wartelobby des eigenen Doppels
 *  und laufende Doppel zum Wiedereinsteigen. Dieselbe 8-s-Abfrage-Taktung wie
 *  PendingOnlineChallenges. Nur sichtbar, wenn es überhaupt etwas zu zeigen gibt. */
const PendingDoublesLobbies = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const [matches, setMatches] = useState<DoublesMatch[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineComment, setDeclineComment] = useState("");
  const startingRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!user) return [] as DoublesMatch[];
    const { data: mine } = await supabase.from("online_match_players").select("match_id").eq("user_id", user.id);
    const ids = (mine ?? []).map((m) => m.match_id);
    if (!ids.length) { setMatches([]); return []; }
    const { data: rows } = await supabase
      .from("online_matches")
      .select("id, status, created_by, mode, best_of_legs, best_of_sets, custom_start_score, double_in, double_out, starter, team_names")
      .in("id", ids)
      .eq("is_doubles", true)
      .in("status", ["pending", "active"]);
    const result: DoublesMatch[] = [];
    for (const r of rows ?? []) {
      const seats = await loadDoublesSeats(r.id);
      const tn = Array.isArray(r.team_names) && r.team_names.length === 2 ? (r.team_names as [string, string]) : null;
      result.push({
        id: r.id,
        status: r.status as "pending" | "active",
        created_by: r.created_by,
        mode: r.mode as DoublesMatchSettings["mode"],
        teamNames: tn,
        seats,
        settings: {
          mode: r.mode as DoublesMatchSettings["mode"],
          bestOfLegs: r.best_of_legs,
          bestOfSets: r.best_of_sets,
          customStartScore: r.custom_start_score,
          doubleIn: r.double_in,
          doubleOut: r.double_out,
          starter: r.starter as DoublesMatchSettings["starter"],
        },
      });
    }
    setMatches(result);
    return result;
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const tick = async () => {
      const current = await load();
      if (cancelled) return;
      // Two last acceptances can land at the same instant, each thinking the other is still open:
      // the lobby is then complete but still 'pending'. Whoever sees that first starts the match
      // (re-accepting is idempotent server-side).
      for (const m of current) {
        if (m.status === "pending" && m.seats.length === 4 && m.seats.every((s) => s.status === "accepted") && !startingRef.current.has(m.id)) {
          startingRef.current.add(m.id);
          await respondToDoubles(m.id, true, { settings: m.settings, teamNames: m.teamNames });
          startingRef.current.delete(m.id);
          if (!cancelled) await load();
        }
      }
    };
    void tick();
    const interval = window.setInterval(tick, 8000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [user, load]);

  const respond = async (m: DoublesMatch, accept: boolean, reason?: string) => {
    if (!user) return;
    setBusyId(m.id);
    const res = await respondToDoubles(m.id, accept, { reason, settings: m.settings, teamNames: m.teamNames });
    setBusyId(null);
    if (res.status === "error") {
      toast({ title: t("players.challengeFailed"), description: res.error, variant: "destructive" });
      return;
    }
    if (!accept) {
      const me = m.seats.find((s) => s.userId === user.id);
      m.seats.filter((s) => s.userId !== user.id).forEach((s) => notifyDoublesDeclined(s.userId, me?.name ?? "Jemand", reason?.trim() || undefined));
      setDecliningId(null);
      setDeclineComment("");
    }
    if (accept && res.status === "active") notifyDoublesStarted(m.seats.filter((s) => s.userId !== user.id).map((s) => s.userId));
    await load();
  };

  const withdraw = async (m: DoublesMatch) => {
    setBusyId(m.id);
    await supabase.rpc("cancel_online_doubles", { _match_id: m.id });
    setBusyId(null);
    await load();
  };

  if (!user || matches.length === 0) return null;

  return (
    <>
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-3 flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5 text-accent" /> {t("home.doublesLobbies")}
      </h2>
      <div className="space-y-2 mb-6">
        {matches.map((m) => {
          const mySeat = m.seats.find((s) => s.userId === user.id);
          const iAmInvited = mySeat?.status === "invited";
          const iAmCaptain = m.created_by === user.id;
          const teamA = [m.seats[0], m.seats[2]];
          const teamB = [m.seats[1], m.seats[3]];
          const label = (team: DoublesSeat[], idx: number) =>
            m.teamNames?.[idx] || (team[0] && team[1] ? defaultTeamName(team[0].name, team[1].name) : "?");
          return (
            <div key={m.id} className={`rounded-xl border px-4 py-3 ${m.status === "active" ? "border-primary/40 bg-card" : "gradient-card border-border shadow-elevation-sm"}`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-semibold truncate">
                  {label(teamA, 0)} <span className="text-muted-foreground font-normal">{t("home.versus")}</span> {label(teamB, 1)}
                </p>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                  {modeLabel(t, m.settings)} · {t("stats.firstTo")} {Math.ceil(m.settings.bestOfLegs / 2)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-3">
                {m.seats.map((s) => {
                  const Icon = STATUS_ICON[s.status];
                  return (
                    <div key={s.slot} className="flex items-center gap-1.5 text-xs min-w-0">
                      <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${s.status === "accepted" ? "bg-primary/20 text-primary" : s.status === "declined" ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground"}`}>
                        <Icon className="w-2.5 h-2.5" />
                      </span>
                      <span className="truncate">{s.emoji} {s.name}</span>
                      <span className="text-[9px] uppercase text-muted-foreground shrink-0">{teamOfSlot(s.slot) === 0 ? "A" : "B"}</span>
                    </div>
                  );
                })}
              </div>

              {m.status === "active" ? (
                <Button asChild size="sm" className="w-full gap-1.5 font-display uppercase">
                  <Link to={`/game?online=${m.id}`}><Play className="w-3.5 h-3.5" /> {t("home.joinMatch")}</Link>
                </Button>
              ) : decliningId === m.id ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={declineComment}
                    onChange={(e) => setDeclineComment(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void respond(m, false, declineComment); }}
                    placeholder={t("home.declineCommentPlaceholder")}
                    maxLength={200}
                    className="flex-1 min-w-0 rounded-lg bg-muted border border-border px-3 py-1.5 text-sm text-foreground"
                  />
                  <Button size="sm" variant="ghost" disabled={busyId === m.id} onClick={() => { setDecliningId(null); setDeclineComment(""); }}>{t("common.cancel")}</Button>
                  <Button size="sm" variant="destructive" disabled={busyId === m.id} onClick={() => respond(m, false, declineComment)}>{t("home.declineChallenge")}</Button>
                </div>
              ) : iAmInvited ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" disabled={busyId === m.id} onClick={() => setDecliningId(m.id)}>
                    <X className="w-3.5 h-3.5 mr-1" /> {t("home.declineChallenge")}
                  </Button>
                  <Button size="sm" className="flex-1" disabled={busyId === m.id} onClick={() => respond(m, true)}>
                    <Check className="w-3.5 h-3.5 mr-1" /> {t("home.acceptChallenge")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Hourglass className="w-3 h-3" /> {t("home.doublesWaiting")}
                  </p>
                  {iAmCaptain && (
                    <Button size="sm" variant="ghost" className="text-xs h-7 text-muted-foreground" disabled={busyId === m.id} onClick={() => withdraw(m)}>
                      {t("home.doublesWithdraw")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default PendingDoublesLobbies;
