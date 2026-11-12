import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Trophy, Plus, Pencil, Trash2, Check, Users, Swords, CalendarDays, Radio, QrCode, Copy, Layers, X, FlagTriangleRight, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useToast } from "@/hooks/use-toast";
import { usePlayers } from "@/hooks/usePlayers";
import { notifyChallengeCreated } from "@/lib/onlineMatchNotify";
import { applyLeagueFixtureResult } from "@/lib/leagueFixtureSync";
import { downloadIcsEvent } from "@/utils/calendarExport";
import QrCodeDialog from "@/components/QrCodeDialog";
import { enqueueLeagueFixtureResult } from "@/lib/offlineQueue";
import { generateRoundRobinFixtures } from "@/utils/roundRobin";
import TournamentSetupWizard, { type WizardStep } from "@/components/tournament/setup/TournamentSetupWizard";
import ManageTabs, { type ManageTab } from "@/components/tournament/manage/ManageTabs";
import CompetitionHeader from "@/components/competition/CompetitionHeader";
import CompetitionListRow from "@/components/competition/CompetitionListRow";
import SectionLabel from "@/components/competition/SectionLabel";
import ChoiceChips from "@/components/competition/ChoiceChips";
import ParticipantPicker from "@/components/competition/ParticipantPicker";
import LeagueStandingsTable, { type LeagueStandingsTableRow } from "@/components/league/LeagueStandingsTable";
import LeagueFixtureCard from "@/components/league/LeagueFixtureCard";
import LeagueFixtureActions from "@/components/league/LeagueFixtureActions";
import LeagueRoundHeader from "@/components/league/LeagueRoundHeader";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";
import { LOCALE_BY_LANGUAGE } from "@/i18n/translations";

interface LeagueRow {
  id: string;
  name: string;
  format: "single" | "double";
  result_mode: "live" | "manual";
  game_mode: string;
  best_of_legs: number;
  participant_ids: string[];
  status: string;
  created_by: string;
  created_at: string;
  /** Öffentliche Liga-Ansicht (2026-09-09) — same opt-in pattern as tournaments'
   *  public_view/public_slug (see the migration's doc comment for the full precedent). */
  public_view: boolean;
  public_slug: string | null;
  /** Saison-Liga mit Auf-/Abstieg (2026-09-10) — see the migration's own doc comment for the full
   *  reasoning. A standalone league (the vast majority) is simply season_number=1,
   *  division_level=1, with no sibling rows sharing its season_group_id. */
  season_number: number;
  division_level: number;
  division_name: string | null;
  season_group_id: string | null;
  relegate_count: number;
  promote_count: number;
  previous_season_league_id: string | null;
  next_season_league_id: string | null;
}

interface FixtureRow {
  id: string;
  league_id: string;
  round_number: number;
  leg: "single" | "first" | "return";
  player1_id: string;
  player2_id: string;
  status: "pending" | "finished";
  winner_id: string | null;
  player1_legs_won: number | null;
  player2_legs_won: number | null;
  /** Öffentliche Liga-Ansicht (2026-09-09): denormalized at fixture-creation time (createLeague()
   *  below) so PublicLeague.tsx's anon visitors can see player names without needing access to the
   *  authenticated-only `players` table — mirrors how tournament brackets already store player
   *  names as plain strings rather than FKs. Organizer-side rendering in this file still uses
   *  playerById (the live, editable roster) — these columns exist purely for the public view. */
  player1_name: string | null;
  player2_name: string | null;
  /** Round 3 Rang 10: organizer-set matchday (Spieltag) date, shared across every fixture in the
   *  same round_number — distinct from played_at (only set once a fixture is actually finished). */
  scheduled_date: string | null;
}

const BEST_OF_OPTIONS = [1, 3, 5, 7];

interface StandingRow { playerId: string; played: number; won: number; lost: number; points: number; legsFor: number; legsAgainst: number }

/** Pure standings computation, pulled out of the `standings` useMemo below so endSeason() (see
 *  its own doc comment further down) can reuse the EXACT SAME points/legs-difference ranking for
 *  every sibling division when a season-liga ends — the ranking that decides who's promoted and
 *  who's relegated must be identical to what the standings table itself already shows. */
function computeStandings(participantIds: string[], leagueFixtures: FixtureRow[]): StandingRow[] {
  const map = new Map<string, StandingRow>();
  participantIds.forEach((pid) => map.set(pid, { playerId: pid, played: 0, won: 0, lost: 0, points: 0, legsFor: 0, legsAgainst: 0 }));
  leagueFixtures.filter((f) => f.status === "finished").forEach((f) => {
    const s1 = map.get(f.player1_id);
    const s2 = map.get(f.player2_id);
    if (!s1 || !s2) return;
    s1.played++; s2.played++;
    s1.legsFor += f.player1_legs_won ?? 0; s1.legsAgainst += f.player2_legs_won ?? 0;
    s2.legsFor += f.player2_legs_won ?? 0; s2.legsAgainst += f.player1_legs_won ?? 0;
    if (f.winner_id === f.player1_id) { s1.won++; s1.points += 2; s2.lost++; }
    else if (f.winner_id === f.player2_id) { s2.won++; s2.points += 2; s1.lost++; }
  });
  return Array.from(map.values()).sort((a, b) =>
    b.points - a.points || (b.legsFor - b.legsAgainst) - (a.legsFor - a.legsAgainst)
  );
}

/** Structured round-robin competition with an auto-generated fixture list — distinct from ad-hoc
 *  Tournament brackets (elimination) and TournamentSeries (points across separately-run
 *  tournaments). Two views in one component, same pattern as TournamentSeries.tsx: list+create
 *  when no :id, standings+fixtures when there is one. */
const LeaguePage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { t, language } = useLanguage();
  const { clubId } = useClubBranding();
  const { toast } = useToast();

  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  // Round 3 Rang 4: shared/cached club roster (see usePlayers.ts) instead of this page's own
  // fetchClubPlayers() call inside fetchAll below — kept the `dbPlayers` name so every existing
  // consumer of it further down in this file (playerById, the participant checklist, ...) is
  // untouched.
  const { data: dbPlayers = [], isLoading: playersLoading } = usePlayers();
  const [loading, setLoading] = useState(true);
  const [fixtures, setFixtures] = useState<FixtureRow[]>([]);

  const [creating, setCreating] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [leagueTab, setLeagueTab] = useState("table");
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"single" | "double">("single");
  const [resultMode, setResultMode] = useState<"live" | "manual">("live");
  const [gameMode, setGameMode] = useState("501");
  const [bestOfLegs, setBestOfLegs] = useState(3);
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [savingLeague, setSavingLeague] = useState(false);
  const [editingLeagueId, setEditingLeagueId] = useState<string | null>(null);

  // Saison-Liga mit Auf-/Abstieg (2026-09-10): opt-in at creation time only — an already-created
  // simple league can't be converted afterwards (its fixtures are already generated from a single
  // roster, same reason format/participants aren't editable post-creation either). When on,
  // `divisions` REPLACES selectedParticipants as the source of truth for who plays where; each
  // division needs at least 2 participants of its own, same minimum as a plain league.
  const [seasonLigaMode, setSeasonLigaMode] = useState(false);
  const [divisions, setDivisions] = useState<{ name: string; participantIds: Set<string> }[]>([
    { name: "1. Liga", participantIds: new Set() },
    { name: "2. Liga", participantIds: new Set() },
  ]);
  const [swapCount, setSwapCount] = useState(2);

  const [publicToggling, setPublicToggling] = useState(false);

  const [manualEntryFixture, setManualEntryFixture] = useState<FixtureRow | null>(null);
  const [manualP1Legs, setManualP1Legs] = useState("");
  const [manualP2Legs, setManualP2Legs] = useState("");
  const [savingResult, setSavingResult] = useState(false);

  const fetchAll = useCallback(async () => {
    const l = await supabase.from("leagues").select("*").order("created_at", { ascending: false });
    if (l.data) setLeagues(l.data as unknown as LeagueRow[]);
    setLoading(false);
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const activeLeague = id ? leagues.find((l) => l.id === id) ?? null : null;

  const fetchFixtures = useCallback(async () => {
    if (!id) { setFixtures([]); return; }
    const { data } = await supabase.from("league_fixtures").select("*").eq("league_id", id).order("round_number");
    setFixtures((data as unknown as FixtureRow[]) ?? []);
  }, [id]);
  useEffect(() => { fetchFixtures(); }, [fetchFixtures]);

  const [savingRoundDate, setSavingRoundDate] = useState<number | null>(null);
  /** Round 3 Rang 10: writes one matchday date to every fixture sharing this round_number — a
   *  Spieltag is scheduled as a whole, not fixture-by-fixture (see the migration's doc comment for
   *  why this is a plain shared column rather than a separate per-round table). `date` is an empty
   *  string to clear a previously-set date (the <input type="date"> onChange value on clear). */
  const setRoundScheduledDate = async (round: number, date: string) => {
    if (!id) return;
    setSavingRoundDate(round);
    const { error } = await supabase.from("league_fixtures")
      .update({ scheduled_date: date || null })
      .eq("league_id", id)
      .eq("round_number", round);
    setSavingRoundDate(null);
    if (error) {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
      return;
    }
    await fetchFixtures();
  };

  /** Online league: every matchday gets a deadline one week after the previous one (first one a
   *  week from today). The organizer can still adjust each date by hand afterwards. */
  const scheduleRoundsWeekly = async () => {
    if (!id) return;
    const rounds = [...new Set(fixtures.map((f) => f.round_number))].sort((a, b) => a - b);
    setSavingRoundDate(-1);
    for (const [i, round] of rounds.entries()) {
      const d = new Date();
      d.setDate(d.getDate() + 7 * (i + 1));
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const { error } = await supabase.from("league_fixtures").update({ scheduled_date: iso }).eq("league_id", id).eq("round_number", round);
      if (error) { toast({ title: t("common.error"), description: error.message, variant: "destructive" }); break; }
    }
    setSavingRoundDate(null);
    await fetchFixtures();
  };

  const playerById = useMemo(() => new Map(dbPlayers.map((p) => [p.id, p])), [dbPlayers]);

  const standings = useMemo(() => {
    if (!activeLeague) return [];
    return computeStandings(activeLeague.participant_ids, fixtures);
  }, [activeLeague, fixtures]);

  const pagedStandings = usePagedList(standings);
  const fixturesByRound = useMemo(() => {
    const rounds = new Map<number, FixtureRow[]>();
    fixtures.forEach((f) => {
      if (!rounds.has(f.round_number)) rounds.set(f.round_number, []);
      rounds.get(f.round_number)!.push(f);
    });
    return Array.from(rounds.entries()).sort(([a], [b]) => a - b);
  }, [fixtures]);
  const pagedLeagues = usePagedList(leagues);

  const resetForm = () => {
    setName(""); setFormat("single"); setResultMode("live"); setGameMode("501"); setBestOfLegs(3);
    setSelectedParticipants(new Set()); setCreating(false); setEditingLeagueId(null); setWizardStep(0);
    setSeasonLigaMode(false);
    setDivisions([{ name: "1. Liga", participantIds: new Set() }, { name: "2. Liga", participantIds: new Set() }]);
    setSwapCount(2);
  };

  const addDivision = () => setDivisions((prev) => [...prev, { name: `${prev.length + 1}. Liga`, participantIds: new Set() }]);
  const removeDivision = (idx: number) => setDivisions((prev) => prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx));
  const renameDivision = (idx: number, newName: string) => setDivisions((prev) => prev.map((d, i) => i === idx ? { ...d, name: newName } : d));
  const toggleDivisionParticipant = (idx: number, pid: string) => setDivisions((prev) => prev.map((d, i) => {
    if (i !== idx) return d;
    const next = new Set(d.participantIds);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    return { ...d, participantIds: next };
  }));

  const toggleParticipant = (pid: string) => setSelectedParticipants((prev) => {
    const next = new Set(prev);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    return next;
  });

  const startEditLeague = (l: LeagueRow) => {
    setName(l.name);
    setFormat(l.format);
    setResultMode(l.result_mode);
    setGameMode(l.game_mode);
    setBestOfLegs(l.best_of_legs);
    setSelectedParticipants(new Set(l.participant_ids));
    setEditingLeagueId(l.id);
    setCreating(true);
  };

  // Renaming/changing result mode or game settings is always safe post-creation; format and
  // participants are NOT editable here since the fixture list is already generated from them —
  // changing either would desync the schedule from what's actually being played. The edit form
  // hides those two fields and explains why rather than silently ignoring a change to them.
  const saveLeagueEdit = async () => {
    if (!editingLeagueId || !name.trim() || savingLeague) return;
    setSavingLeague(true);
    try {
      const { error } = await supabase.from("leagues").update({
        name: name.trim(), result_mode: resultMode, game_mode: gameMode, best_of_legs: bestOfLegs,
      }).eq("id", editingLeagueId);
      if (error) throw error;
      toast({ title: t("league.leagueUpdatedTitle") });
      resetForm();
      await fetchAll();
    } catch (err: unknown) {
      toast({ title: t("common.error"), description: err instanceof Error ? err.message : t("league.saveEditFailedGeneric"), variant: "destructive" });
    } finally {
      setSavingLeague(false);
    }
  };

  /** `player1_name`/`player2_name` are recently-added columns (Öffentliche Liga-Ansicht,
   *  2026-09-09) — if this Supabase project hasn't had the migration applied yet, PostgREST
   *  rejects the whole insert with a schema-cache error and league creation broke entirely on
   *  account of two columns nothing here strictly needs to function. Same fallback convention as
   *  Tournament.tsx's missingLivePlayColumn/missingSetsColumn: retry once without them rather than
   *  hard-failing. A league created via this fallback just won't have denormalized names for the
   *  public view until the migration's backfill runs (or the league is recreated afterwards) —
   *  acceptable, since the public view itself is opt-in and off by default anyway. */
  const missingLeagueNameColumn = (error: { code?: string; message?: string } | null) =>
    !!error && (error.code === "42703" || String(error.message || "").includes("player1_name") || String(error.message || "").includes("player2_name"));

  /** Shared by createLeague() below AND endSeason() further down — generates a round-robin
   *  fixture list for one league's roster and inserts it, with the same missingLeagueNameColumn
   *  fallback either caller needs. Pulled out specifically so the season-liga/season-end paths
   *  (which do this once PER DIVISION) don't have to duplicate the fallback-retry logic. */
  const insertFixturesForLeague = async (leagueId: string, participantIds: string[], leagueFormat: "single" | "double") => {
    const generated = generateRoundRobinFixtures(participantIds, leagueFormat);
    const fixtureRows = generated.map((f) => ({
      league_id: leagueId, club_id: clubId, round_number: f.round, leg: f.leg,
      player1_id: f.player1Id, player2_id: f.player2Id,
      player1_name: playerById.get(f.player1Id)?.name ?? null,
      player2_name: playerById.get(f.player2Id)?.name ?? null,
    }));
    let { error: fxError } = await supabase.from("league_fixtures").insert(fixtureRows);
    if (fxError && missingLeagueNameColumn(fxError)) {
      const strippedRows = fixtureRows.map(({ player1_name: _p1n, player2_name: _p2n, ...rest }) => rest);
      ({ error: fxError } = await supabase.from("league_fixtures").insert(strippedRows));
    }
    if (fxError) throw fxError;
    return generated.length;
  };

  const createLeague = async () => {
    if (!name.trim() || !session?.user?.id || savingLeague) return;
    if (seasonLigaMode ? divisions.some((d) => !d.name.trim() || d.participantIds.size < 2) : selectedParticipants.size < 2) return;
    setSavingLeague(true);
    try {
      if (seasonLigaMode) {
        // One shared season_group_id ties every division together across its whole lifetime (see
        // the migration's doc comment) — generated client-side so it's known before any division
        // row exists, rather than needing a second round-trip to backfill it onto each insert.
        const seasonGroupId = crypto.randomUUID();
        let firstDivisionId: string | null = null;
        let totalFixtures = 0;
        for (let i = 0; i < divisions.length; i++) {
          const d = divisions[i];
          const participantIds = Array.from(d.participantIds);
          const { data: league, error } = await supabase.from("leagues").insert({
            name: `${name.trim()} — ${d.name.trim()}`,
            format, result_mode: resultMode, game_mode: gameMode, best_of_legs: bestOfLegs,
            participant_ids: participantIds, club_id: clubId, created_by: session.user.id,
            division_level: i + 1, division_name: d.name.trim(), season_group_id: seasonGroupId,
            season_number: 1, promote_count: swapCount, relegate_count: swapCount,
          }).select().single();
          if (error) throw error;
          if (i === 0) firstDivisionId = league.id;
          totalFixtures += await insertFixturesForLeague(league.id, participantIds, format);
        }
        toast({ title: t("league.seasonLigaCreatedTitle"), description: `${divisions.length} ${t("league.divisionsSuffix")} · ${totalFixtures} ${t("league.fixturesGeneratedSuffix")}` });
        resetForm();
        await fetchAll();
        if (firstDivisionId) navigate(`/leagues/${firstDivisionId}`);
        return;
      }

      const participantIds = Array.from(selectedParticipants);
      const { data: league, error } = await supabase.from("leagues").insert({
        name: name.trim(),
        format,
        result_mode: resultMode,
        game_mode: gameMode,
        best_of_legs: bestOfLegs,
        participant_ids: participantIds,
        club_id: clubId,
        created_by: session.user.id,
      }).select().single();
      if (error) throw error;

      const fixtureCount = await insertFixturesForLeague(league.id, participantIds, format);

      toast({ title: t("league.leagueCreatedTitle"), description: `${fixtureCount} ${t("league.fixturesGeneratedSuffix")}` });
      resetForm();
      await fetchAll();
      navigate(`/leagues/${league.id}`);
    } catch (err: unknown) {
      toast({ title: t("common.error"), description: err instanceof Error ? err.message : t("league.createFailedGeneric"), variant: "destructive" });
    } finally {
      setSavingLeague(false);
    }
  };

  const deleteLeague = async (leagueId: string) => {
    try {
      const { error } = await supabase.from("leagues").delete().eq("id", leagueId);
      if (error) throw error;
      toast({ title: t("league.leagueDeletedTitle") });
      await fetchAll();
    } catch (err: unknown) {
      toast({ title: t("common.error"), description: err instanceof Error ? err.message : t("league.deleteFailedGeneric"), variant: "destructive" });
    }
  };

  // Öffentliche Liga-Ansicht (2026-09-09) — same opt-in toggle pattern as Tournament.tsx's
  // togglePublicView, minus the confirm-dialog-on-disable (a league's public view has no
  // beamer/tablet watching it live the way a tournament's does, so turning it off going dark
  // for a spectator mid-glance isn't a real risk here). Refetches via fetchAll() afterwards
  // rather than an optimistic local update, matching this file's existing saveLeagueEdit/
  // deleteLeague pattern (activeLeague is derived from `leagues`, not its own state slot).
  const togglePublicView = async () => {
    if (!activeLeague) return;
    setPublicToggling(true);
    const next = !activeLeague.public_view;
    let slug = activeLeague.public_slug;
    if (next && !slug) {
      slug = `${activeLeague.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "liga"}-${activeLeague.id.slice(0, 6)}`;
    }
    const { error } = await supabase.from("leagues").update({ public_view: next, public_slug: slug }).eq("id", activeLeague.id);
    if (error) {
      toast({ title: t("common.error"), description: t("league.publicViewToggleFailed"), variant: "destructive" });
    } else {
      toast({ title: next ? t("league.publicViewActive") : t("league.publicViewDeactivated"), description: next && slug ? `${window.location.origin}/liga-live/${slug}` : undefined });
      await fetchAll();
    }
    setPublicToggling(false);
  };

  const [endingSeason, setEndingSeason] = useState(false);
  const [showEndSeasonDialog, setShowEndSeasonDialog] = useState(false);

  /** Saison beenden & neue Saison starten (2026-09-10): the season-liga payoff — computes final
   *  standings for EVERY division sharing this league's season_group_id + season_number, applies
   *  each boundary's promotion/relegation swap (see computeStandings' own doc comment on why the
   *  ranking must match the visible table), and spins up season_number+1 as a fresh set of league
   *  rows with reshuffled rosters and a brand new fixture list per division — reusing
   *  insertFixturesForLeague exactly like createLeague() does. Works just as well for a plain
   *  single-division league (the loop over boundaries below simply never runs since there's only
   *  one sibling), so "Saison beenden" is offered on every league, not just season-ligas —
   *  carrying the roster forward into a fresh fixture list is a useful reset on its own. */
  const endSeason = async () => {
    if (!activeLeague || endingSeason || !session?.user?.id) return;
    setEndingSeason(true);
    try {
      const siblings = leagues
        .filter((l) => l.season_group_id === activeLeague.season_group_id && l.season_number === activeLeague.season_number)
        .sort((a, b) => a.division_level - b.division_level);
      const ids = siblings.map((l) => l.id);
      const { data: allFixturesData, error: fxFetchError } = await supabase
        .from("league_fixtures").select("*").in("league_id", ids);
      if (fxFetchError) throw fxFetchError;
      const allFixtures = (allFixturesData as unknown as FixtureRow[]) ?? [];
      const fixturesByLeague = new Map<string, FixtureRow[]>();
      ids.forEach((lid) => fixturesByLeague.set(lid, allFixtures.filter((f) => f.league_id === lid)));

      const standingsByLeague = new Map<string, StandingRow[]>();
      siblings.forEach((l) => standingsByLeague.set(l.id, computeStandings(l.participant_ids, fixturesByLeague.get(l.id) ?? [])));

      // Start every division's next-season roster as its own current roster, then apply each
      // adjacent boundary's swap independently — see the migration's doc comment on relegate_count
      // vs promote_count and why min() is taken (a mismatched pair degrades safely rather than
      // erroring or leaving mismatched division sizes).
      const nextRoster = new Map<string, Set<string>>(siblings.map((l) => [l.id, new Set(l.participant_ids)]));
      for (let i = 0; i < siblings.length - 1; i++) {
        const upper = siblings[i], lower = siblings[i + 1];
        const n = Math.min(upper.relegate_count, lower.promote_count);
        if (n <= 0) continue;
        const relegated = (standingsByLeague.get(upper.id) ?? []).slice(-n).map((s) => s.playerId);
        const promoted = (standingsByLeague.get(lower.id) ?? []).slice(0, n).map((s) => s.playerId);
        relegated.forEach((pid) => { nextRoster.get(upper.id)?.delete(pid); nextRoster.get(lower.id)?.add(pid); });
        promoted.forEach((pid) => { nextRoster.get(lower.id)?.delete(pid); nextRoster.get(upper.id)?.add(pid); });
      }

      let newActiveLeagueId: string | null = null;
      for (const l of siblings) {
        const participantIds = Array.from(nextRoster.get(l.id) ?? []);
        const { data: newLeague, error } = await supabase.from("leagues").insert({
          name: l.name, format: l.format, result_mode: l.result_mode, game_mode: l.game_mode,
          best_of_legs: l.best_of_legs, participant_ids: participantIds, club_id: clubId,
          created_by: session.user.id, division_level: l.division_level, division_name: l.division_name,
          season_group_id: l.season_group_id, season_number: l.season_number + 1,
          promote_count: l.promote_count, relegate_count: l.relegate_count,
          previous_season_league_id: l.id,
        }).select().single();
        if (error) throw error;
        await insertFixturesForLeague(newLeague.id, participantIds, l.format);
        // Best-effort: only succeeds under RLS for divisions THIS user created (see the migration
        // file's "League creator can update their league" policy) — a season-liga whose divisions
        // were created by different organizers just won't get every old row's
        // next_season_league_id/status updated, which only affects the "vorherige/nächste Saison"
        // navigation link, not correctness of the new season itself (already fully created above
        // regardless of who owns the old row).
        await supabase.from("leagues").update({ status: "finished", next_season_league_id: newLeague.id }).eq("id", l.id);
        if (l.id === activeLeague.id) newActiveLeagueId = newLeague.id;
      }

      toast({ title: t("league.seasonEndedTitle"), description: `${t("league.seasonLabel")} ${activeLeague.season_number + 1}` });
      setShowEndSeasonDialog(false);
      await fetchAll();
      if (newActiveLeagueId) navigate(`/leagues/${newActiveLeagueId}`);
    } catch (err: unknown) {
      toast({ title: t("common.error"), description: err instanceof Error ? err.message : t("league.seasonEndFailedGeneric"), variant: "destructive" });
    } finally {
      setEndingSeason(false);
    }
  };

  const copyPublicLink = () => {
    if (!activeLeague?.public_slug) return;
    const url = `${window.location.origin}/liga-live/${activeLeague.public_slug}`;
    navigator.clipboard.writeText(url).then(() => toast({ title: t("tournament.linkCopied"), description: url }));
  };

  const startFixtureGame = (f: FixtureRow) => {
    const p1 = playerById.get(f.player1_id);
    const p2 = playerById.get(f.player2_id);
    if (!p1 || !p2 || !activeLeague) return;
    const params = new URLSearchParams({
      lid: activeLeague.id, fid: f.id, p1id: p1.id, p2id: p2.id,
      p1: p1.name, p2: p2.name, mode: activeLeague.game_mode, bestOf: String(activeLeague.best_of_legs),
    });
    navigate(`/game?${params.toString()}`);
  };

  const [startingOnlineId, setStartingOnlineId] = useState<string | null>(null);

  // Two-device sync for a fixture, reusing the same online_matches mechanism as a casual
  // challenge (source_type='league', source_id=fixture.id) -- see Game.tsx's matching effect
  // that resolves this back into a league_fixtures write-back once the match finishes. Only
  // offered to the two fixture participants themselves (mirrors the RLS insert policy, which
  // would reject anyone else's attempt anyway), and only when both have a real linked account.
  const startFixtureOnline = async (f: FixtureRow) => {
    const myUserId = session?.user?.id;
    const p1 = playerById.get(f.player1_id);
    const p2 = playerById.get(f.player2_id);
    if (!myUserId || !p1?.user_id || !p2?.user_id || !clubId) return;
    const opponentUserId = myUserId === p1.user_id ? p2.user_id : p1.user_id;
    setStartingOnlineId(f.id);
    try {
      const { data: existing } = await supabase
        .from("online_matches")
        .select("id")
        .eq("source_type", "league").eq("source_id", f.id).in("status", ["pending", "active"])
        .maybeSingle();
      if (existing) {
        navigate(`/game?online=${existing.id}`);
        return;
      }
      const { data: created, error } = await supabase.from("online_matches").insert({
        club_id: clubId, source_type: "league", source_id: f.id,
        created_by: myUserId, player1_user_id: myUserId, player2_user_id: opponentUserId,
        mode: activeLeague!.game_mode as "501" | "301" | "cricket", best_of_legs: activeLeague!.best_of_legs,
      }).select("id").single();
      if (error) throw error;
      const myName = myUserId === p1.user_id ? p1.name : p2.name;
      notifyChallengeCreated(opponentUserId, myName, activeLeague!.game_mode as "501" | "301" | "cricket");
      navigate(`/game?online=${created.id}`);
    } catch (err: unknown) {
      toast({ title: t("common.error"), description: err instanceof Error ? err.message : t("league.startOnlineFailedGeneric"), variant: "destructive" });
    } finally {
      setStartingOnlineId(null);
    }
  };

  const openManualEntry = (f: FixtureRow) => {
    setManualEntryFixture(f);
    setManualP1Legs(""); setManualP2Legs("");
  };

  const submitManualResult = async () => {
    if (!manualEntryFixture || savingResult) return;
    const l1 = parseInt(manualP1Legs, 10);
    const l2 = parseInt(manualP2Legs, 10);
    if (!Number.isFinite(l1) || !Number.isFinite(l2) || l1 < 0 || l2 < 0 || l1 === l2) return;
    setSavingResult(true);
    const result = {
      winnerId: l1 > l2 ? manualEntryFixture.player1_id : manualEntryFixture.player2_id,
      player1LegsWon: l1,
      player2LegsWon: l2,
      guardPending: false, // manual entry may legitimately correct an already-finished fixture
    };
    try {
      await applyLeagueFixtureResult(manualEntryFixture.id, result);
      setManualEntryFixture(null);
      await fetchFixtures();
    } catch (err: unknown) {
      // Round 3 backend audit KORREKTUR: previously a failed write here just surfaced the error
      // toast below and left the fixture untouched with no other recourse but clicking Save again
      // — fine while the admin is still looking at the dialog, but if the connection drops right
      // as they submit and they navigate away trusting the toast, the result was gone for good.
      // Queuing it (same as Game.tsx's write-back) means it still lands automatically even then;
      // the dialog stays open and the error toast still fires so an admin who's still there and
      // wants to retry immediately can just click Save again.
      await enqueueLeagueFixtureResult({ id: crypto.randomUUID(), fixtureId: manualEntryFixture.id, ...result });
      toast({ title: t("common.error"), description: err instanceof Error ? err.message : t("league.saveResultFailedQueuedGeneric"), variant: "destructive" });
    } finally {
      setSavingResult(false);
    }
  };

  const legLabel = (leg: FixtureRow["leg"]) => leg === "first" ? t("league.firstLegLabel") : leg === "return" ? t("league.returnLegLabel") : null;

  // ─── SINGLE LEAGUE DETAIL ────────────────────────
  if (id && activeLeague) {
    const isLeagueOrganizer = activeLeague.created_by === session?.user?.id;
    // Saison-Liga mit Auf-/Abstieg (2026-09-10): every OTHER division of the SAME season (not
    // every season — last season's divisions are a different season_number and irrelevant to the
    // navigation/zone-highlighting here), sorted top-division-first, so index 0 is always
    // division_level 1 regardless of creation order.
    const seasonSiblings = leagues
      .filter((l) => l.season_group_id === activeLeague.season_group_id && l.season_number === activeLeague.season_number)
      .sort((a, b) => a.division_level - b.division_level);
    const isSeasonLiga = seasonSiblings.length > 1;
    const myDivisionIdx = seasonSiblings.findIndex((l) => l.id === activeLeague.id);
    const hasDivisionAbove = myDivisionIdx > 0;
    const hasDivisionBelow = myDivisionIdx >= 0 && myDivisionIdx < seasonSiblings.length - 1;
    const unfinishedFixtureCount = fixtures.filter((f) => f.status !== "finished").length;
    const seasonPanel = (
      <div className="space-y-5">
    {isSeasonLiga && (
      <section>
        <SectionLabel>{t("league.divisionsSuffix")}</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {seasonSiblings.map((l) => (
            <Link
              key={l.id}
              to={`/leagues/${l.id}`}
              aria-current={l.id === activeLeague.id ? "page" : undefined}
              className={`flex min-h-11 items-center rounded-xl border px-3.5 text-sm font-semibold transition-colors ${l.id === activeLeague.id ? "border-primary bg-primary/15 text-primary" : "border-border bg-card text-foreground hover:bg-muted"}`}
            >
              {l.division_name ?? `${t("league.divisionLabel")} ${l.division_level}`}
            </Link>
          ))}
        </div>
      </section>
    )}

    {isLeagueOrganizer && (
      <section className="rounded-2xl border border-border bg-card p-4">
        <SectionLabel>{t("league.seasonLabel")} {activeLeague.season_number}</SectionLabel>
        {activeLeague.next_season_league_id ? (
          <Button asChild variant="outline" className="h-11 gap-1.5 rounded-xl">
            <Link to={`/leagues/${activeLeague.next_season_league_id}`}>
              <FlagTriangleRight className="w-4 h-4" /> {t("league.nextSeasonLink")}
            </Link>
          </Button>
        ) : (
          <AlertDialog open={showEndSeasonDialog} onOpenChange={setShowEndSeasonDialog}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="h-11 gap-1.5 rounded-xl">
                <FlagTriangleRight className="w-4 h-4" /> {t("league.endSeasonBtn")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("league.endSeasonDialogTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {isSeasonLiga ? t("league.endSeasonDialogDescSeasonLiga") : t("league.endSeasonDialogDescSimple")}
                  {unfinishedFixtureCount > 0 && (
                    <span className="mt-2 flex items-center gap-1.5 text-accent">
                      <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
                      <span className="tabular-nums">{unfinishedFixtureCount} {t("league.endSeasonUnfinishedWarning")}</span>
                    </span>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <Button onClick={endSeason} disabled={endingSeason}>
                  {endingSeason ? t("league.savingBtn") : t("league.endSeasonConfirmBtn")}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </section>
    )}
      </div>
    );
    const sharePanel = (
      <>
      {activeLeague.public_view && activeLeague.public_slug && (
        <section className="rounded-2xl border border-border bg-card p-4">
          <SectionLabel>{t("league.publicLinkLabel")}</SectionLabel>
          <p className="mb-3 flex items-center gap-2 text-sm">
            <Radio aria-hidden="true" className="h-4 w-4 shrink-0 text-secondary" />
            <code className="min-w-0 truncate font-mono text-foreground">{window.location.origin}/liga-live/{activeLeague.public_slug}</code>
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="h-11 flex-1 gap-1.5 rounded-xl" onClick={copyPublicLink}>
              <Copy className="w-4 h-4" /> {t("common.copy")}
            </Button>
            <QrCodeDialog
              url={`${window.location.origin}/liga-live/${activeLeague.public_slug}`}
              title={t("league.publicViewBtn")}
              description={t("league.scanForPublicView")}
              downloadName={`liga-live-${activeLeague.public_slug}`}
              trigger={
                <Button variant="outline" className="h-11 flex-1 gap-1.5 rounded-xl">
                  <QrCode className="w-4 h-4" /> QR
                </Button>
              }
            />
          </div>
        </section>
      )}

      </>
    );
    const standingsPanel = (
      <section>
        <SectionLabel>{t("league.standingsTitle")}</SectionLabel>
        {standings.length === 0 ? (
          // Round 3 Rang 7: every list empty state leads with an icon.
          <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
            <Swords className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{t("league.noParticipantsYet")}</p>
          </div>
        ) : (
          <>
            <LeagueStandingsTable
              rows={pagedStandings.visible.map((s): LeagueStandingsTableRow => {
                const i = standings.indexOf(s);
                const player = playerById.get(s.playerId);
                // Saison-Liga mit Auf-/Abstieg (2026-09-10): only meaningful when there's an
                // actual division to move to/from in this direction — a top division has nowhere
                // to promote into, a bottom division has nowhere to relegate to.
                const inPromoteZone = isSeasonLiga && hasDivisionAbove && i < activeLeague.promote_count;
                const inRelegateZone = isSeasonLiga && hasDivisionBelow && i >= standings.length - activeLeague.relegate_count;
                return {
                  playerId: s.playerId, rank: i + 1, name: player?.name ?? "?", emoji: player?.emoji ?? null,
                  played: s.played, won: s.won, legsFor: s.legsFor, legsAgainst: s.legsAgainst, points: s.points,
                  zone: inPromoteZone ? "promote" : inRelegateZone ? "relegate" : null,
                };
              })}
            />
            <ListPaginationFooter list={pagedStandings} />
          </>
        )}
      </section>
    );
    // The first open fixture (lowest round) carries the screen's one filled button.
    const nextUpFixtureId = fixturesByRound.flatMap(([, roundFixtures]) => roundFixtures).find((f) => f.status === "pending")?.id ?? null;
    const todayIso = new Date().toISOString().slice(0, 10);
    const fixturesPanel = (
      <section>
        <SectionLabel
          trailing={isLeagueOrganizer && fixturesByRound.length > 0 ? (
            <Button variant="outline" className="h-11 gap-1.5 rounded-xl text-sm" disabled={savingRoundDate !== null} onClick={scheduleRoundsWeekly}>
              <CalendarDays className="w-4 h-4" /> {t("league.scheduleWeekly")}
            </Button>
          ) : (
            <span className="text-[13px] tabular-nums text-muted-foreground">
              {t("league.openFixturesCount").replace("{count}", String(unfinishedFixtureCount))}
            </span>
          )}
        >
          {t("league.fixturesTitle")}
        </SectionLabel>
        {fixturesByRound.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t("league.noFixturesYet")}</p>
        ) : (
          <div className="space-y-5">
            {fixturesByRound.map(([round, roundFixtures]) => {
              const scheduledDate = roundFixtures[0].scheduled_date;
              const roundOverdue = !!scheduledDate && scheduledDate < todayIso && roundFixtures.some((fx) => fx.status !== "finished");
              const roundLegLabel = legLabel(roundFixtures[0].leg);
              return (
              <div key={round}>
                {/* Round 3 Rang 10: a Spieltag is scheduled as a whole round, not per fixture —
                    see setRoundScheduledDate's doc comment. Only the organizer edits the date;
                    the calendar export is offered to everyone once a date is set. */}
                <LeagueRoundHeader
                  label={`${t("league.roundLabel")} ${round}${roundLegLabel ? ` · ${roundLegLabel}` : ""}`}
                  overdue={roundOverdue}
                  scheduledDate={scheduledDate}
                  formattedDate={scheduledDate ? new Date(scheduledDate).toLocaleDateString(LOCALE_BY_LANGUAGE[language], { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }) : null}
                  editable={isLeagueOrganizer}
                  saving={savingRoundDate === round}
                  onDateChange={(date) => setRoundScheduledDate(round, date)}
                  onExportCalendar={() => {
                    if (!scheduledDate) return;
                    downloadIcsEvent(
                      {
                        date: scheduledDate,
                        uid: `league-${activeLeague.id}-round-${round}`,
                        title: `${activeLeague.name} · ${t("league.roundLabel")} ${round}`,
                        description: roundFixtures.map((f) => {
                          const p1 = playerById.get(f.player1_id);
                          const p2 = playerById.get(f.player2_id);
                          return `${p1?.name ?? "?"} vs ${p2?.name ?? "?"}`;
                        }).join("\n"),
                      },
                      `${activeLeague.name.replace(/\s+/g, "_")}-Runde${round}.ics`,
                    );
                  }}
                />
                <div className="grid gap-2 lg:grid-cols-2">
                  {roundFixtures.map((f) => {
                    const p1 = playerById.get(f.player1_id);
                    const p2 = playerById.get(f.player2_id);
                    const myUserId = session?.user?.id;
                    return (
                      <LeagueFixtureCard
                        key={f.id}
                        player1={{ name: p1?.name ?? "?", emoji: p1?.emoji ?? null, isWinner: f.winner_id === f.player1_id }}
                        player2={{ name: p2?.name ?? "?", emoji: p2?.emoji ?? null, isWinner: f.winner_id === f.player2_id }}
                        score={f.status === "finished" ? { player1: f.player1_legs_won, player2: f.player2_legs_won } : null}
                        actions={f.status === "pending" ? (
                          <LeagueFixtureActions
                            resultMode={activeLeague.result_mode}
                            isNextUp={f.id === nextUpFixtureId}
                            canPlayOnline={!!myUserId && [p1?.user_id, p2?.user_id].includes(myUserId) && !!p1?.user_id && !!p2?.user_id}
                            startingOnline={startingOnlineId === f.id}
                            onPlay={() => startFixtureGame(f)}
                            onPlayOnline={() => startFixtureOnline(f)}
                            onEnterResult={() => openManualEntry(f)}
                          />
                        ) : undefined}
                      />
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </section>
    );
    const leagueTabs: ManageTab[] = [
      { key: "table", label: t("league.tabTable"), icon: Trophy, content: standingsPanel },
      { key: "fixtures", label: t("league.tabFixtures"), icon: CalendarDays, content: fixturesPanel },
      { key: "season", label: t("league.tabSeason"), icon: FlagTriangleRight, content: seasonPanel, hidden: !isSeasonLiga && !isLeagueOrganizer },
      { key: "share", label: t("league.tabShare"), icon: QrCode, content: sharePanel, hidden: !(activeLeague.public_view && activeLeague.public_slug) },
    ];
    return (
      <div className="container py-6 animate-slide-up max-w-3xl lg:max-w-6xl mx-auto">
        <CompetitionHeader
          backTo="/leagues"
          backLabel={t("league.allLeaguesLink")}
          kicker={[
            activeLeague.game_mode,
            `${activeLeague.participant_ids.length} ${t("league.participantsSuffix")}`,
            `${t("league.seasonLabel")} ${activeLeague.season_number}`,
            isSeasonLiga ? activeLeague.division_name ?? `${t("league.divisionLabel")} ${activeLeague.division_level}` : null,
          ].filter(Boolean).join(" · ")}
          title={activeLeague.name}
          action={isLeagueOrganizer ? (
            // Öffentliche Liga-Ansicht (2026-09-09): organizer-only, same opt-in switch as
            // Tournament.tsx's own "Live-Ansicht" button — everyone else simply never sees it.
            <Button
              variant="outline"
              aria-pressed={activeLeague.public_view}
              disabled={publicToggling}
              onClick={togglePublicView}
              className={`h-11 gap-1.5 rounded-xl px-3.5 ${activeLeague.public_view ? "border-secondary/60 text-secondary hover:text-secondary" : ""}`}
            >
              <Radio className="w-4 h-4" />
              <span className="hidden sm:inline">{activeLeague.public_view ? t("tournament.liveOn") : t("league.publicViewBtn")}</span>
              <span className="sr-only sm:hidden">{activeLeague.public_view ? t("tournament.liveOn") : t("league.publicViewBtn")}</span>
            </Button>
          ) : undefined}
        >
          <p className="text-sm text-muted-foreground">
            {t("stats.firstTo")} {Math.ceil(activeLeague.best_of_legs / 2)} · {activeLeague.format === "double" ? t("league.doubleRoundLabel") : t("league.singleRoundLabel")} ·{" "}
            {activeLeague.result_mode === "live" ? t("league.liveGamesLabel") : t("league.manualEntryLabel")}
          </p>
          {/* Saison-Liga mit Auf-/Abstieg (2026-09-10) — links between the seasons of the same league. */}
          {(activeLeague.previous_season_league_id || activeLeague.next_season_league_id) && (
            <div className="flex flex-wrap items-center gap-2">
              {activeLeague.previous_season_league_id && (
                <Link to={`/leagues/${activeLeague.previous_season_league_id}`} className="flex min-h-11 items-center gap-1 rounded-xl border border-border px-3 text-sm text-muted-foreground hover:text-foreground">
                  <ChevronLeft aria-hidden="true" className="h-4 w-4" /> {t("league.previousSeasonLink")}
                </Link>
              )}
              {activeLeague.next_season_league_id && (
                <Link to={`/leagues/${activeLeague.next_season_league_id}`} className="flex min-h-11 items-center gap-1 rounded-xl border border-border px-3 text-sm text-foreground hover:bg-muted">
                  {t("league.nextSeasonLink")} <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              )}
            </div>
          )}
        </CompetitionHeader>

        <ManageTabs tabs={leagueTabs} active={leagueTab} onChange={setLeagueTab} />

        <Dialog open={!!manualEntryFixture} onOpenChange={(open) => !open && setManualEntryFixture(null)}>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl font-bold">{t("league.enterResultDialogTitle")}</DialogTitle>
            </DialogHeader>
            {manualEntryFixture && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 items-end">
                  <div>
                    <label htmlFor="league-manual-p1-legs" className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-1.5 block truncate">
                      {playerById.get(manualEntryFixture.player1_id)?.name ?? t("league.player1Label")}
                    </label>
                    <Input id="league-manual-p1-legs" type="number" inputMode="numeric" min={0} value={manualP1Legs} onChange={(e) => setManualP1Legs(e.target.value)} className="h-14 rounded-xl bg-muted border-border text-center font-display text-3xl font-bold tabular-nums" />
                  </div>
                  <div>
                    <label htmlFor="league-manual-p2-legs" className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-1.5 block truncate">
                      {playerById.get(manualEntryFixture.player2_id)?.name ?? t("league.player2Label")}
                    </label>
                    <Input id="league-manual-p2-legs" type="number" inputMode="numeric" min={0} value={manualP2Legs} onChange={(e) => setManualP2Legs(e.target.value)} className="h-14 rounded-xl bg-muted border-border text-center font-display text-3xl font-bold tabular-nums" />
                  </div>
                </div>
                {manualP1Legs !== "" && manualP2Legs !== "" && manualP1Legs === manualP2Legs && (
                  <p className="text-xs text-destructive">{t("league.noDrawAllowedMsg")}</p>
                )}
                <Button
                  className="h-12 w-full gap-1.5 rounded-xl font-semibold"
                  disabled={savingResult || manualP1Legs === "" || manualP2Legs === "" || manualP1Legs === manualP2Legs}
                  onClick={submitManualResult}
                >
                  {savingResult ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t("game.save")}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ─── CREATE / EDIT (steps) ────────────────────────
  if (creating) {
    const divisionsInvalid = seasonLigaMode && divisions.some((d) => !d.name.trim() || d.participantIds.size < 2);
    const participantsInvalid = !editingLeagueId && (seasonLigaMode ? divisionsInvalid : selectedParticipants.size < 2);
    const participantCount = seasonLigaMode ? divisions.reduce((sum, d) => sum + d.participantIds.size, 0) : selectedParticipants.size;
    const summaryRows: [string, string][] = [
      [t("common.name"), name.trim() || "–"],
      [t("league.gameModeLabel"), `${gameMode} · ${t("stats.firstTo")} ${Math.ceil(bestOfLegs / 2)}`],
      [t("league.formatLabel"), format === "double" ? t("league.doubleRoundLabel") : t("league.singleRoundLabel")],
      [t("league.resultModeLabel"), resultMode === "live" ? t("league.liveModeOption") : t("league.manualModeOption")],
      [t("league.participantsLabel"), seasonLigaMode && !editingLeagueId ? `${participantCount} · ${divisions.length} ${t("league.divisionLabel")}` : String(participantCount)],
    ];
    const steps: WizardStep[] = [
      {
        key: "basics", title: t("tournament.wizardBasics"), icon: Swords,
        issues: name.trim() ? [] : [t("league.issueName")],
        content: (
          <div className="space-y-4">
            <section className="rounded-2xl border border-border bg-card p-4">
              <label htmlFor="league-name" className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("common.name")}</label>
              <Input id="league-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("league.namePlaceholder")} className="h-12 rounded-xl bg-muted border-border text-base" />
            </section>

            <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
              <ChoiceChips
                label={t("league.gameModeLabel")}
                options={[{ value: "501", label: "501" }, { value: "301", label: "301" }, { value: "Cricket", label: "Cricket" }]}
                value={gameMode}
                onChange={setGameMode}
              />
              <ChoiceChips
                label={t("tournament.firstToLegsLabel")}
                options={BEST_OF_OPTIONS.map((n) => ({ value: n, label: `${t("stats.firstTo")} ${Math.ceil(n / 2)}` }))}
                value={bestOfLegs}
                onChange={setBestOfLegs}
                columnsClass="grid-cols-2 sm:grid-cols-4"
              />
            </section>

            <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
              {/* Format is fixed once the fixture list exists — the edit form leaves it out (see saveLeagueEdit). */}
              {!editingLeagueId && (
                <ChoiceChips
                  label={t("league.formatLabel")}
                  options={[{ value: "single", label: t("league.singleRoundLabel") }, { value: "double", label: t("league.doubleRoundLabel") }]}
                  value={format}
                  onChange={setFormat}
                />
              )}
              <ChoiceChips
                label={t("league.resultModeLabel")}
                options={[{ value: "live", label: t("league.liveModeOption") }, { value: "manual", label: t("league.manualModeOption") }]}
                value={resultMode}
                onChange={setResultMode}
              />
            </section>
          </div>
        ),
      },
      {
        key: "players", title: t("tournament.wizardPlayers"), icon: Users,
        issues: participantsInvalid ? [seasonLigaMode ? t("league.issueDivisions") : t("league.issueParticipants")] : [],
        content: (
          <div className="space-y-4">
          {editingLeagueId ? (
            <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
              {t("league.editRestrictionNotice")}
            </p>
          ) : (
            <>
              {/* Saison-Liga mit Auf-/Abstieg (2026-09-10) — opt-in toggle, only offered at
                  creation time (see the state declarations' own doc comment for why). */}
              <section className="rounded-2xl border border-border bg-card p-4">
                <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Layers className="w-4 h-4 text-primary shrink-0" />
                    {t("league.seasonLigaToggleLabel")}
                  </span>
                  <Switch checked={seasonLigaMode} onCheckedChange={setSeasonLigaMode} />
                </label>
                {seasonLigaMode && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("league.seasonLigaExplainer")}
                  </p>
                )}
              </section>

              {seasonLigaMode ? (
                <>
                  <section className="rounded-2xl border border-border bg-card p-4">
                    <ChoiceChips
                      label={t("league.swapCountLabel")}
                      options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
                      value={swapCount}
                      onChange={setSwapCount}
                    />
                  </section>

                  {divisions.map((d, idx) => (
                    <section key={idx} className="space-y-3 rounded-2xl border border-border bg-card p-4">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("league.divisionLabel")} {idx + 1}</span>
                        <Input
                          value={d.name}
                          aria-label={`${t("league.divisionLabel")} ${idx + 1}`}
                          onChange={(e) => renameDivision(idx, e.target.value)}
                          className="h-11 flex-1 rounded-xl bg-muted border-border text-sm"
                        />
                        {divisions.length > 2 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${t("league.divisionLabel")} ${idx + 1}: ${t("stats.delete")}`}
                            onClick={() => removeDivision(idx)}
                            className="h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                      <ParticipantPicker
                        label={t("league.participantsLabel")}
                        players={dbPlayers}
                        selected={d.participantIds}
                        onToggle={(pid) => toggleDivisionParticipant(idx, pid)}
                        maxHeightClass="max-h-[30vh]"
                      />
                    </section>
                  ))}
                  <Button variant="outline" onClick={addDivision} className="h-11 w-full gap-1.5 rounded-xl">
                    <Plus className="w-4 h-4" /> {t("league.addDivisionBtn")}
                  </Button>
                </>
              ) : (
                <section className="rounded-2xl border border-border bg-card p-4">
                  <ParticipantPicker
                    label={t("league.participantsLabel")}
                    players={dbPlayers}
                    selected={selectedParticipants}
                    onToggle={toggleParticipant}
                  />
                </section>
              )}
            </>
          )}
          </div>
        ),
      },
      {
        key: "review", title: t("tournament.wizardReview"), icon: Check, issues: [],
        content: (
          <section className="rounded-2xl border border-border bg-card px-4 py-2">
            <dl className="divide-y divide-border/60 text-sm">
              {summaryRows.map(([label, value]) => (
                <div key={label} className="flex min-h-11 items-center justify-between gap-3 py-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="truncate text-right font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ),
      },
    ];
    return (
      <TournamentSetupWizard
        heading={<CompetitionHeader kicker={t("league.pageTitle")} title={editingLeagueId ? t("league.editLeagueBtn") : t("league.newLeagueBtn")} />}
        steps={steps}
        current={wizardStep}
        onChange={setWizardStep}
        onExit={resetForm}
        finalAction={
          <Button
            onClick={editingLeagueId ? saveLeagueEdit : createLeague}
            className="h-12 w-full font-display text-base uppercase tracking-wide"
            disabled={!name.trim() || savingLeague || participantsInvalid}
          >
            {savingLeague ? t("league.savingBtn") : editingLeagueId ? t("league.saveChangesBtn") : t("league.createLeagueBtn")}
          </Button>
        }
      />
    );
  }

  // ─── LIST ─────────────────────────────────────────
  const finishedLeagueCount = leagues.filter((l) => l.status === "finished").length;
  const startCreating = () => { setWizardStep(0); setCreating(true); };
  return (
    <div className="container py-6 animate-slide-up max-w-3xl lg:max-w-5xl mx-auto">
      <CompetitionHeader
        backTo="/tournament"
        backLabel={t("league.tournamentsLink")}
        kicker={`${leagues.length - finishedLeagueCount} ${t("league.activeStatusLabel")} · ${finishedLeagueCount} ${t("league.finishedStatusLabel")}`}
        title={t("league.pageTitle")}
        action={leagues.length > 0 ? (
          <Button onClick={startCreating} className="h-11 gap-1.5 rounded-xl px-3.5 font-semibold">
            <Plus className="w-4 h-4" /> {t("league.newLeagueBtn")}
          </Button>
        ) : undefined}
      />

      {loading || playersLoading ? (
        <div role="status" aria-label={t("common.loading")} className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : leagues.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
          <Swords className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t("league.noLeaguesYet")}</p>
          <Button className="mt-4 h-11 gap-1.5 rounded-xl font-semibold" onClick={startCreating}><Plus className="h-4 w-4" /> {t("league.createFirstLeague")}</Button>
        </div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {pagedLeagues.visible.map((l) => (
            <CompetitionListRow
              key={l.id}
              to={`/leagues/${l.id}`}
              icon={Swords}
              title={l.name}
              meta={
                <>
                  <span className="tabular-nums">{l.participant_ids.length}</span> {t("league.participantsSuffix")} · {l.format === "double" ? t("league.doubleRoundLabel") : t("league.singleRoundLabel")} ·{" "}
                  <span className={l.status === "finished" ? "" : "text-secondary"}>{l.status === "finished" ? t("league.finishedStatusLabel") : t("league.activeStatusLabel")}</span>
                  {/* Saison-Liga mit Auf-/Abstieg (2026-09-10) — only shown once it's actually
                      relevant (a division, or past season 1), so a plain league's row is
                      unchanged from before this feature existed. */}
                  {(l.division_name || l.season_number > 1) && (
                    <> · {l.division_name ?? `${t("league.divisionLabel")} ${l.division_level}`}{l.season_number > 1 ? ` · ${t("league.seasonLabel")} ${l.season_number}` : ""}</>
                  )}
                </>
              }
              actions={l.created_by === session?.user?.id ? (
                <>
                  <Button variant="ghost" size="icon" className="h-11 w-11" title={t("league.editLeagueBtn")} aria-label={t("league.editLeagueBtn")} onClick={() => startEditLeague(l)}>
                    <Pencil className="w-4 h-4 text-muted-foreground hover:text-primary" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-11 w-11" title={t("league.deleteLeagueBtn")} aria-label={t("league.deleteLeagueBtn")}>
                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("league.deleteLeagueDialogTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          „{l.name}" {t("league.deleteLeagueDescSuffix")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteLeague(l.id)}>{t("stats.delete")}</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              ) : undefined}
            />
          ))}
          <div className="md:col-span-2"><ListPaginationFooter list={pagedLeagues} /></div>
        </div>
      )}
    </div>
  );
};

export default LeaguePage;