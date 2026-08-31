import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Layers, Plus, Trash2, Loader2, Trophy, ArrowLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { type Match, isRealPlayer, totalRoundsOf } from "@/utils/tournament";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";
import { LOCALE_BY_LANGUAGE } from "@/i18n/translations";

interface Scoring {
  champion: number;
  runnerUp: number;
  semi: number;
  quarter: number;
  participation: number;
}

interface Series {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  scoring: Scoring;
  status: string;
  created_at: string;
}

interface TournamentLite {
  id: string;
  name: string;
  status: string;
  champion: string | null;
  players: string[];
  bracket: Json;
  mode: string;
  created_at: string;
  series_id: string | null;
}

const DEFAULT_SCORING: Scoring = { champion: 100, runnerUp: 70, semi: 50, quarter: 30, participation: 10 };

const TournamentSeriesPage = () => {
  const { id } = useParams();
  const { session } = useAuth();
  const { clubId } = useClubBranding();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const [series, setSeries] = useState<Series[]>([]);
  const [tournaments, setTournaments] = useState<TournamentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingSeries, setSavingSeries] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [scoring, setScoring] = useState<Scoring>(DEFAULT_SCORING);

  const fetchAll = useCallback(async () => {
    const [s, t] = await Promise.all([
      supabase.from("tournament_series").select("*").order("created_at", { ascending: false }),
      supabase.from("tournaments").select("id, name, status, champion, players, bracket, mode, created_at, series_id").order("created_at", { ascending: false }),
    ]);
    if (s.data) setSeries(s.data.map((r) => ({ ...r, scoring: (r.scoring as unknown as Scoring) || DEFAULT_SCORING })));
    if (t.data) setTournaments(t.data.map((x) => ({ ...x, players: (x.players as unknown as string[]) || [], bracket: x.bracket || [], series_id: x.series_id || null })));
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const resetForm = () => {
    setName(""); setDesc(""); setScoring(DEFAULT_SCORING); setCreating(false); setEditingId(null);
  };

  const startEdit = (s: Series) => {
    setName(s.name); setDesc(s.description || ""); setScoring(s.scoring);
    setEditingId(s.id); setCreating(true);
  };

  const saveSeries = async () => {
    if (!name.trim() || !session?.user?.id || savingSeries) return;
    setSavingSeries(true);
    try {
      const { error } = editingId
        ? await supabase.from("tournament_series").update({
            name: name.trim(), description: desc.trim() || null, scoring: scoring as unknown as Json,
          }).eq("id", editingId)
        : await supabase.from("tournament_series").insert({
            user_id: session.user.id, club_id: clubId, name: name.trim(), description: desc.trim() || null, scoring: scoring as unknown as Json,
          });
      if (error) { toast({ title: t("common.error"), description: error.message, variant: "destructive" }); return; }
      resetForm();
      fetchAll();
    } finally {
      setSavingSeries(false);
    }
  };

  const deleteSeries = async (sid: string) => {
    await supabase.from("tournament_series").delete().eq("id", sid);
    fetchAll();
  };

  const activeSeries = id ? series.find((s) => s.id === id) : null;
  // Computed unconditionally (not inside the `if (id && activeSeries)` branch below) so the
  // usePagedList hook calls that depend on them stay unconditional too — this page early-returns
  // per-branch, and a hook called only inside one branch would violate the rules of hooks the
  // moment `id`/`activeSeries` themselves change (e.g. navigating list <-> detail).
  const seriesTourneys = id ? tournaments.filter((t) => t.series_id === id) : [];
  const standings = activeSeries ? computeStandings(seriesTourneys, activeSeries.scoring) : [];
  const pagedStandings = usePagedList(standings);
  const pagedSeriesTourneys = usePagedList(seriesTourneys);
  const pagedSeries = usePagedList(series);

  // ─── SINGLE SERIES DETAIL ────────────────────────
  if (id && activeSeries) {
    return (
      <div className="container py-6 animate-slide-up max-w-4xl mx-auto">
        <Link to="/tournaments/series" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> {t("series.allSeries")}
        </Link>

        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <Layers className="w-6 h-6 text-accent" />
            <h2 className="text-2xl font-display uppercase">{activeSeries.name}</h2>
          </div>
          {activeSeries.description && <p className="text-sm text-muted-foreground">{activeSeries.description}</p>}
        </div>

        <div className="bg-card border border-border rounded-xl p-4 mb-4">
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">{t("series.overallStandings")}</h3>
          {standings.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("series.noTournamentsFinishedYet")}</p>
          ) : (
            <div className="space-y-1">
              {pagedStandings.visible.map((s) => {
                // True rank in the full standings, not the index within this page/slice.
                const i = standings.indexOf(s);
                return (
                  <div key={s.name} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/40">
                    <div className="flex items-center gap-3">
                      <span className={`font-display w-8 ${i === 0 ? "text-accent" : ""}`}>
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                      </span>
                      <span className="font-semibold text-sm">{s.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {s.champions > 0 && `${s.champions}× 🏆 · `}{s.tournaments} {t("series.tournamentsSuffix")}
                      </span>
                    </div>
                    <span className="font-display text-primary text-lg">{s.points} {t("tournament.pointsAbbrev")}</span>
                  </div>
                );
              })}
              <ListPaginationFooter list={pagedStandings} />
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">{t("series.tournamentsSuffix")} ({seriesTourneys.length})</h3>
          {seriesTourneys.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-3">{t("series.noTournamentsAssigned")}</p>
              <Button asChild size="sm">
                <Link to="/tournament">{t("tournament.createTournamentHeading")}</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {pagedSeriesTourneys.visible.map((t) => (
                <Link key={t.id} to={`/tournament/${t.id}`} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted transition-colors">
                  <span className="text-sm font-medium">{t.name}</span>
                  {t.champion && <span className="text-xs text-accent">🏆 {t.champion}</span>}
                </Link>
              ))}
              <ListPaginationFooter list={pagedSeriesTourneys} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── LIST + CREATE ───────────────────────────────
  return (
    <div className="container py-6 animate-slide-up max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Layers className="w-6 h-6 text-accent" />
          <h2 className="text-2xl font-display uppercase">{t("series.pageTitle")}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/tournament" className="text-xs text-muted-foreground hover:text-foreground">← {t("tournament.tournaments")}</Link>
          <Button size="sm" onClick={() => (creating ? resetForm() : setCreating(true))} className="gap-1">
            <Plus className="w-4 h-4" /> {creating ? t("common.cancel") : t("series.newSeries")}
          </Button>
        </div>
      </div>

      {creating && (
        <div className="bg-card border border-primary/30 rounded-xl p-4 mb-4 space-y-3">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t("common.name")}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Winter Series 2026" />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t("common.description")}</label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("common.optional")} rows={2} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-2 block">{t("series.pointDistribution")}</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {(["champion", "runnerUp", "semi", "quarter", "participation"] as const).map((k) => (
                <div key={k}>
                  <label className="text-[10px] uppercase text-muted-foreground">{k === "champion" ? "1." : k === "runnerUp" ? "2." : k === "semi" ? t("series.semifinalAbbrev") : k === "quarter" ? t("series.quarterfinalAbbrev") : t("series.participationAbbrev")}</label>
                  <Input type="number" value={scoring[k]} onChange={(e) => setScoring({ ...scoring, [k]: parseInt(e.target.value) || 0 })} className="h-8 text-sm" />
                </div>
              ))}
            </div>
          </div>
          <Button onClick={saveSeries} className="w-full" disabled={!name.trim() || savingSeries}>
            {savingSeries ? t("tournament.saving") : editingId ? t("tournament.saveChanges") : t("series.createSeries")}
          </Button>
        </div>
      )}

      {loading ? (
        <div role="status" aria-label={t("common.loading")} className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : series.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t("series.noSeriesYet")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pagedSeries.visible.map((s) => {
            const count = tournaments.filter((tourn) => tourn.series_id === s.id).length;
            return (
              <div key={s.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
                <Link to={`/tournaments/series/${s.id}`} className="flex-1">
                  <p className="font-semibold text-sm">{s.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{count} {t("series.tournamentsSuffix")} · {new Date(s.created_at).toLocaleDateString(LOCALE_BY_LANGUAGE[language])}</p>
                </Link>
                {s.user_id === session?.user?.id && (
                  <div className="flex items-center">
                  <Button variant="ghost" size="icon" title={t("series.editSeries")} aria-label={t("series.editSeries")} onClick={() => startEdit(s)}>
                    <Pencil className="w-4 h-4 text-muted-foreground hover:text-primary" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" title={t("series.deleteSeries")} aria-label={t("series.deleteSeries")}>
                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("series.deleteSeriesConfirm")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          „{s.name}" {t("series.deleteSeriesWarning")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteSeries(s.id)}>{t("stats.delete")}</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  </div>
                )}
              </div>
            );
          })}
          <ListPaginationFooter list={pagedSeries} />
        </div>
      )}
    </div>
  );
};

// ─── Standings calculation ─────────────────────────
interface Standing { name: string; points: number; champions: number; tournaments: number; }

function computeStandings(tourneys: TournamentLite[], scoring: Scoring): Standing[] {
  const map: Record<string, Standing> = {};
  // Key by a normalized name so "Max", "max", and "Max " (trailing space) — all easy to hit given
  // free-text player entry across separate tournaments — don't silently split one person's points
  // across multiple rows. Display keeps the first-seen exact casing/spacing, only grouping is normalized.
  const normalize = (s: string) => s.trim().toLowerCase();
  const add = (name: string, pts: number, isChamp = false) => {
    if (!isRealPlayer(name)) return;
    const key = normalize(name);
    if (!key) return;
    if (!map[key]) map[key] = { name: name.trim(), points: 0, champions: 0, tournaments: 0 };
    map[key].points += pts;
    if (isChamp) map[key].champions++;
  };

  for (const t of tourneys) {
    if (t.status !== "finished") continue;
    const played = new Set<string>();
    (t.players || []).forEach((p) => {
      if (!isRealPlayer(p)) return;
      played.add(p);
      add(p, scoring.participation);
      // Exactly once per player per tournament — add() itself is called again below for
      // champion/runner-up/semi/quarter bonuses, which would over-count if tallied there instead.
      const key = normalize(p);
      if (map[key]) map[key].tournaments++;
    });

    if (t.mode !== "round-robin" && Array.isArray(t.bracket)) {
      const matches = t.bracket as unknown as Match[];
      if (matches.length > 0) {
        const totalRounds = totalRoundsOf(matches);
        const finalM = matches.find((m) => m.round === totalRounds);
        if (finalM?.winner) add(finalM.winner, scoring.champion - scoring.participation, true);
        const runnerUp = finalM && finalM.winner ? (finalM.winner === finalM.player1 ? finalM.player2 : finalM.player1) : undefined;
        if (isRealPlayer(runnerUp)) add(runnerUp, scoring.runnerUp - scoring.participation);
        // Semifinal losers
        if (totalRounds >= 2) {
          matches.filter((m) => m.round === totalRounds - 1 && m.winner).forEach((m) => {
            const loser = m.winner === m.player1 ? m.player2 : m.player1;
            if (isRealPlayer(loser) && loser !== finalM?.winner && loser !== runnerUp) add(loser, scoring.semi - scoring.participation);
          });
        }
        if (totalRounds >= 3) {
          matches.filter((m) => m.round === totalRounds - 2 && m.winner).forEach((m) => {
            const loser = m.winner === m.player1 ? m.player2 : m.player1;
            if (isRealPlayer(loser)) add(loser, scoring.quarter - scoring.participation);
          });
        }
      }
    } else if (t.champion) {
      add(t.champion, scoring.champion - scoring.participation, true);
    }
  }

  return Object.values(map).sort((a, b) => b.points - a.points);
}

export default TournamentSeriesPage;