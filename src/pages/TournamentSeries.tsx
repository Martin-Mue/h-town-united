import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Layers, Plus, Trash2, Trophy, Pencil, ChevronRight } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
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
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useHasRole } from "@/hooks/useHasRole";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { type Match, type RoundRobinMatch, isRealPlayer, totalRoundsOf, calcStandings } from "@/utils/tournament";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";
import { LOCALE_BY_LANGUAGE } from "@/i18n/translations";
import TournamentSetupWizard, { type WizardStep } from "@/components/tournament/setup/TournamentSetupWizard";
import ManageTabs, { type ManageTab } from "@/components/tournament/manage/ManageTabs";
import CompetitionHeader from "@/components/competition/CompetitionHeader";
import CompetitionListRow from "@/components/competition/CompetitionListRow";
import SectionLabel from "@/components/competition/SectionLabel";
import SeriesStandingsTable, { type SeriesStandingsTableRow } from "@/components/series/SeriesStandingsTable";

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
  const isAdmin = useIsAdmin(session?.user?.id);
  const isEditor = useHasRole(session?.user?.id, "editor");
  const { clubId } = useClubBranding();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const [series, setSeries] = useState<Series[]>([]);
  const [tournaments, setTournaments] = useState<TournamentLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [detailTab, setDetailTab] = useState("standings");
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
    setName(""); setDesc(""); setScoring(DEFAULT_SCORING); setCreating(false); setEditingId(null); setWizardStep(0);
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
    const finishedTourneyCount = seriesTourneys.filter((x) => x.status === "finished").length;
    const standingsPanel = (
      <section>
        <SectionLabel>{t("series.overallStandings")}</SectionLabel>
        {standings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
            <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t("series.noTournamentsFinishedYet")}</p>
          </div>
        ) : (
          <>
            <SeriesStandingsTable
              rows={pagedStandings.visible.map((s): SeriesStandingsTableRow => ({
                // True rank in the full standings, not the index within this page/slice.
                rank: standings.indexOf(s) + 1,
                name: s.name, tournaments: s.tournaments, champions: s.champions, points: s.points,
              }))}
            />
            <ListPaginationFooter list={pagedStandings} />
          </>
        )}
      </section>
    );
    const tournamentsPanel = (
      <section>
        <SectionLabel trailing={<span className="text-[13px] tabular-nums text-muted-foreground">{seriesTourneys.length}</span>}>
          {t("series.tournamentsSuffix")}
        </SectionLabel>
        {seriesTourneys.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">{t("series.noTournamentsAssigned")}</p>
            <Button asChild className="h-11 rounded-xl font-semibold">
              <Link to="/tournament">{t("tournament.createTournamentHeading")}</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {pagedSeriesTourneys.visible.map((tourney) => (
              <Link key={tourney.id} to={`/tournament/${tourney.id}`} className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3 transition-colors hover:border-primary/40">
                <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground">
                  <Trophy className="w-5 h-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{tourney.name}</span>
                  <span className="block text-xs text-muted-foreground">{new Date(tourney.created_at).toLocaleDateString(LOCALE_BY_LANGUAGE[language])}</span>
                </span>
                {tourney.champion && (
                  <span className="flex min-w-0 max-w-[40%] shrink-0 items-center gap-1 text-xs text-accent">
                    <Trophy aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{tourney.champion}</span>
                  </span>
                )}
                <ChevronRight aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
              </Link>
            ))}
            <div className="lg:col-span-2"><ListPaginationFooter list={pagedSeriesTourneys} /></div>
          </div>
        )}
      </section>
    );
    const detailTabs: ManageTab[] = [
      { key: "standings", label: t("series.overallStandings"), icon: Trophy, content: standingsPanel },
      { key: "tournaments", label: t("series.tournamentsSuffix"), icon: Layers, content: tournamentsPanel },
    ];
    return (
      <div className="container py-6 animate-slide-up max-w-4xl lg:max-w-6xl mx-auto">
        <CompetitionHeader
          backTo="/tournaments/series"
          backLabel={t("series.allSeries")}
          kicker={`${finishedTourneyCount}/${seriesTourneys.length} ${t("series.tournamentsSuffix")} · ${standings.length} ${t("league.participantsSuffix")}`}
          title={activeSeries.name}
        >
          {activeSeries.description && <p className="text-sm text-muted-foreground">{activeSeries.description}</p>}
        </CompetitionHeader>

        <ManageTabs tabs={detailTabs} active={detailTab} onChange={setDetailTab} />
      </div>
    );
  }

  // ─── CREATE / EDIT (steps) ────────────────────────
  if (creating) {
    const placementLabel = (k: keyof Scoring) =>
      k === "champion" ? "1." : k === "runnerUp" ? "2." : k === "semi" ? t("series.semifinalAbbrev") : k === "quarter" ? t("series.quarterfinalAbbrev") : t("series.participationAbbrev");
    const steps: WizardStep[] = [
      {
        key: "basics", title: t("tournament.wizardBasics"), icon: Layers,
        issues: name.trim() ? [] : [t("series.issueName")],
        content: (
          <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
          <div>
            <label htmlFor="series-name" className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("common.name")}</label>
            <Input id="series-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Winter Series 2026" className="h-12 rounded-xl bg-muted border-border text-base" />
          </div>
          <div>
            <label htmlFor="series-description" className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("common.description")}</label>
            <Textarea id="series-description" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("common.optional")} rows={2} className="rounded-xl bg-muted border-border" />
          </div>
          </section>
        ),
      },
      {
        key: "points", title: t("series.pointDistribution"), icon: Trophy, issues: [],
        content: (
          <section className="rounded-2xl border border-border bg-card p-4">
            <SectionLabel>{t("series.pointDistribution")}</SectionLabel>
            {/* Round 3 Rang 15: explanation + live preview — these five numbers are each the FULL
                point total for that placement (computeStandings below adds participation for
                everyone first, then only the delta above it for champion/runnerUp/semi/quarter),
                which reads easily as "bonus on top of participation" without this hint. The
                preview re-reads straight from `scoring` state, so it updates as the organizer
                types — no separate computation, just the same numbers shown as an outcome. */}
            <p className="text-xs text-muted-foreground mb-3">{t("series.pointDistributionHint")}</p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {(["champion", "runnerUp", "semi", "quarter", "participation"] as const).map((k) => (
                <div key={k}>
                  <label htmlFor={`series-points-${k}`} className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{placementLabel(k)}</label>
                  <Input
                    id={`series-points-${k}`}
                    type="number"
                    inputMode="numeric"
                    value={scoring[k]}
                    onChange={(e) => setScoring({ ...scoring, [k]: parseInt(e.target.value) || 0 })}
                    className="h-12 rounded-xl bg-muted border-border text-center font-display text-xl font-bold tabular-nums"
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
              <span className="text-foreground/70">{t("series.previewLabel")}:</span>
              <span>🏆 {scoring.champion} {t("tournament.pointsAbbrev")}</span>
              <span>🥈 {scoring.runnerUp} {t("tournament.pointsAbbrev")}</span>
              <span>{t("series.semifinalAbbrev")} {scoring.semi} {t("tournament.pointsAbbrev")}</span>
              <span>{t("series.quarterfinalAbbrev")} {scoring.quarter} {t("tournament.pointsAbbrev")}</span>
              <span>{t("series.participationAbbrev")} {scoring.participation} {t("tournament.pointsAbbrev")}</span>
            </div>
          </section>
        ),
      },
    ];
    return (
      <TournamentSetupWizard
        heading={<CompetitionHeader kicker={t("series.pageTitle")} title={editingId ? t("series.editSeries") : t("series.newSeries")} />}
        steps={steps}
        current={wizardStep}
        onChange={setWizardStep}
        onExit={resetForm}
        finalAction={
          <Button onClick={saveSeries} className="h-[52px] w-full rounded-[14px] text-base font-semibold" disabled={!name.trim() || savingSeries}>
            {savingSeries ? t("tournament.saving") : editingId ? t("tournament.saveChanges") : t("series.createSeries")}
          </Button>
        }
      />
    );
  }

  // ─── LIST ─────────────────────────────────────────
  const startCreating = () => { setWizardStep(0); setCreating(true); };
  return (
    <div className="container py-6 animate-slide-up max-w-3xl lg:max-w-5xl mx-auto">
      <CompetitionHeader
        backTo="/tournament"
        backLabel={t("tournament.tournaments")}
        kicker={t("series.countLabel").replace("{count}", String(series.length))}
        title={t("series.pageTitle")}
        action={series.length > 0 ? (
          <Button onClick={startCreating} className="h-11 gap-1.5 rounded-xl px-3.5 font-semibold">
            <Plus className="w-4 h-4" /> {t("series.newSeries")}
          </Button>
        ) : undefined}
      />

      {loading ? (
        <div role="status" aria-label={t("common.loading")} className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : series.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
          <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t("series.noSeriesYet")}</p>
          <Button className="mt-4 h-11 gap-1.5 rounded-xl font-semibold" onClick={startCreating}><Plus className="h-4 w-4" /> {t("series.createFirstSeries")}</Button>
        </div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {pagedSeries.visible.map((s) => {
            const count = tournaments.filter((tourn) => tourn.series_id === s.id).length;
            const canEdit = s.user_id === session?.user?.id || isAdmin || isEditor;
            return (
              <CompetitionListRow
                key={s.id}
                to={`/tournaments/series/${s.id}`}
                icon={Layers}
                title={s.name}
                meta={<><span className="tabular-nums">{count}</span> {t("series.tournamentsSuffix")} · {new Date(s.created_at).toLocaleDateString(LOCALE_BY_LANGUAGE[language])}</>}
                actions={canEdit ? (
                  <>
                    <Button variant="ghost" size="icon" className="h-11 w-11" title={t("series.editSeries")} aria-label={t("series.editSeries")} onClick={() => startEdit(s)}>
                      <Pencil className="w-4 h-4 text-muted-foreground hover:text-primary" />
                    </Button>
                    {/* Deleting a season is admin-only, regardless of who created it — it's shared
                        club history at that point, not the creator's personal scratch data. */}
                    {isAdmin && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-11 w-11" title={t("series.deleteSeries")} aria-label={t("series.deleteSeries")}>
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
                    )}
                  </>
                ) : undefined}
              />
            );
          })}
          <div className="md:col-span-2"><ListPaginationFooter list={pagedSeries} /></div>
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
    } else if (t.mode === "round-robin" && Array.isArray(t.bracket)) {
      // Round-robin used to only ever pay out the flat participation point beyond a champion bonus
      // — unlike a KO bracket, where reaching the final/semifinal/quarterfinal each carries its own
      // bonus tier no matter how big the bracket is (Season Rangliste #14). Mirror those same tier
      // SIZES (1 champion, 1 runner-up, up to 2 semi-tier, up to 4 quarter-tier) against
      // calcStandings()'s final ranking — including its head-to-head tiebreak — instead, so a
      // strong round-robin finish (e.g. 2nd of 6) is rewarded the same way a strong bracket run
      // would be, not just the same flat point as someone knocked out in their first match.
      const rrMatches = t.bracket as unknown as RoundRobinMatch[];
      if (rrMatches.some((m) => m.played)) {
        const ranked = calcStandings(rrMatches).filter((s) => isRealPlayer(s.name));
        ranked.forEach((s, i) => {
          if (i === 0) add(s.name, scoring.champion - scoring.participation, true);
          else if (i === 1) add(s.name, scoring.runnerUp - scoring.participation);
          else if (i < 4) add(s.name, scoring.semi - scoring.participation);
          else if (i < 8) add(s.name, scoring.quarter - scoring.participation);
        });
      } else if (t.champion) {
        add(t.champion, scoring.champion - scoring.participation, true);
      }
    } else if (t.champion) {
      add(t.champion, scoring.champion - scoring.participation, true);
    }
  }

  return Object.values(map).sort((a, b) => b.points - a.points);
}

export default TournamentSeriesPage;