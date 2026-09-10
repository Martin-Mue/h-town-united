import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Trophy, Plus, ArrowLeft, Play, Pencil, Trash2, Check, Users, Swords, Wifi, CalendarDays, CalendarPlus, Radio, QrCode, Copy, Layers, ArrowUp, ArrowDown, X, FlagTriangleRight } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { SectionCard, Eyebrow, RankBadge, RankAvatar } from "@/components/stats/StatPrimitives";
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
    setSelectedParticipants(new Set()); setCreating(false); setEditingLeagueId(null);
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
    return (
      <div className="container py-6 animate-slide-up max-w-3xl mx-auto">
        <Link to="/leagues" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> {t("league.allLeaguesLink")}
        </Link>

        <div className="mb-6">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-3 min-w-0">
              <Swords className="w-6 h-6 text-accent shrink-0" />
              <h2 className="text-2xl font-display uppercase truncate">{activeLeague.name}</h2>
            </div>
            {/* Öffentliche Liga-Ansicht (2026-09-09): organizer-only, same opt-in switch as
                Tournament.tsx's own "Live-Ansicht" button — everyone else simply never sees it,
                so the detail view is unchanged for the vast majority of leagues that stay private. */}
            {isLeagueOrganizer && (
              <Button variant={activeLeague.public_view ? "default" : "outline"} size="sm" disabled={publicToggling} onClick={togglePublicView} className="gap-1 shrink-0">
                <Radio className="w-3.5 h-3.5" />
                {activeLeague.public_view ? t("tournament.liveOn") : t("league.publicViewBtn")}
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {activeLeague.game_mode} · {t("stats.firstTo")} {Math.ceil(activeLeague.best_of_legs / 2)} · {activeLeague.format === "double" ? t("league.doubleRoundLabel") : t("league.singleRoundLabel")} ·{" "}
            {activeLeague.result_mode === "live" ? t("league.liveGamesLabel") : t("league.manualEntryLabel")}
          </p>

          {/* Saison-Liga mit Auf-/Abstieg (2026-09-10) — season/division context, shown for every
              league (season badge is harmless even at "Saison 1" of a standalone league) so the
              prev/next-season and "Saison beenden" controls always have a consistent home. */}
          <div className="flex items-center flex-wrap gap-1.5 mt-2.5">
            <Badge variant="outline" className="text-[10px] bg-muted text-foreground border-transparent">
              {t("league.seasonLabel")} {activeLeague.season_number}
            </Badge>
            {isSeasonLiga && (
              <Badge variant="outline" className="text-[10px] bg-primary/15 text-primary border-transparent">
                {activeLeague.division_name ?? `${t("league.divisionLabel")} ${activeLeague.division_level}`}
              </Badge>
            )}
            {activeLeague.previous_season_league_id && (
              <Link to={`/leagues/${activeLeague.previous_season_league_id}`} className="text-[11px] text-muted-foreground hover:text-foreground">
                ← {t("league.previousSeasonLink")}
              </Link>
            )}
            {activeLeague.next_season_league_id && (
              <Link to={`/leagues/${activeLeague.next_season_league_id}`} className="text-[11px] text-primary hover:underline">
                {t("league.nextSeasonLink")} →
              </Link>
            )}
          </div>

          {isSeasonLiga && (
            <div className="flex items-center flex-wrap gap-1.5 mt-2">
              {seasonSiblings.map((l) => (
                <Link
                  key={l.id}
                  to={`/leagues/${l.id}`}
                  className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${l.id === activeLeague.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {l.division_name ?? `${t("league.divisionLabel")} ${l.division_level}`}
                </Link>
              ))}
            </div>
          )}

          {isLeagueOrganizer && (
            <div className="mt-3">
              {activeLeague.next_season_league_id ? (
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <Link to={`/leagues/${activeLeague.next_season_league_id}`}>
                    <FlagTriangleRight className="w-3.5 h-3.5" /> {t("league.nextSeasonLink")}
                  </Link>
                </Button>
              ) : (
                <AlertDialog open={showEndSeasonDialog} onOpenChange={setShowEndSeasonDialog}>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <FlagTriangleRight className="w-3.5 h-3.5" /> {t("league.endSeasonBtn")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("league.endSeasonDialogTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {isSeasonLiga ? t("league.endSeasonDialogDescSeasonLiga") : t("league.endSeasonDialogDescSimple")}
                        {unfinishedFixtureCount > 0 && (
                          <span className="block mt-2 text-accent">
                            {unfinishedFixtureCount} {t("league.endSeasonUnfinishedWarning")}
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
            </div>
          )}
        </div>

        {activeLeague.public_view && activeLeague.public_slug && (
          <div className="bg-gradient-to-r from-secondary/10 via-primary/10 to-accent/10 border border-secondary/30 rounded-xl px-4 py-1.5 text-xs flex items-center gap-2 mb-4">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-secondary animate-pulse shrink-0" />
            <span className="text-muted-foreground shrink-0 hidden sm:inline">{t("league.publicLinkLabel")}</span>
            <code className="font-mono text-secondary truncate">{window.location.origin}/liga-live/{activeLeague.public_slug}</code>
            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              <Button variant="outline" size="sm" className="h-9 px-2.5 text-[11px] gap-1" onClick={copyPublicLink}>
                <Copy className="w-3 h-3" /> {t("common.copy")}
              </Button>
              <QrCodeDialog
                url={`${window.location.origin}/liga-live/${activeLeague.public_slug}`}
                title={t("league.publicViewBtn")}
                description={t("league.scanForPublicView")}
                downloadName={`liga-live-${activeLeague.public_slug}`}
                trigger={
                  <Button variant="outline" size="sm" className="h-9 px-2.5 text-[11px] gap-1">
                    <QrCode className="w-3 h-3" /> QR
                  </Button>
                }
              />
            </div>
          </div>
        )}

        <SectionCard className="mb-4">
          <Eyebrow icon={Trophy}>{t("league.standingsTitle")}</Eyebrow>
          {standings.length === 0 ? (
            // Round 3 Rang 7: the one remaining "pure text" empty state in the app — every other
            // list-empty-state already leads with an icon (Trophy/Layers/Target/... elsewhere),
            // this was the last gap the audit found. Swords matches this page's own header/list
            // icon just below, so it stays visually consistent with the rest of League.tsx too.
            <div className="text-center py-8 text-muted-foreground">
              <Swords className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t("league.noParticipantsYet")}</p>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-2 px-3 text-[10px] text-muted-foreground uppercase mb-1">
                <span className="w-6" />
                <span />
                <span className="w-8 text-center">{t("league.colPlayed")}</span>
                <span className="w-8 text-center">{t("league.colWon")}</span>
                <span className="w-14 text-center">{t("league.colLegs")}</span>
                <span className="w-10 text-right">{t("league.colPoints")}</span>
              </div>
              {pagedStandings.visible.map((s) => {
                const i = standings.indexOf(s);
                const player = playerById.get(s.playerId);
                // Saison-Liga mit Auf-/Abstieg (2026-09-10): only meaningful when there's an
                // actual division to move to/from in this direction — a top division has nowhere
                // to promote into, a bottom division has nowhere to relegate to.
                const inPromoteZone = isSeasonLiga && hasDivisionAbove && i < activeLeague.promote_count;
                const inRelegateZone = isSeasonLiga && hasDivisionBelow && i >= standings.length - activeLeague.relegate_count;
                return (
                  <div key={s.playerId} className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-2 px-3 py-2 rounded-lg border-l-2 ${inPromoteZone ? "border-l-secondary bg-secondary/5" : inRelegateZone ? "border-l-destructive bg-destructive/5" : "border-l-transparent"} ${i < 3 ? "bg-muted/50" : "bg-muted/30"}`}>
                    <RankBadge rank={i + 1} />
                    <div className="flex items-center gap-2 min-w-0">
                      <RankAvatar emoji={player?.emoji ?? "🎯"} rank={i + 1} size={26} />
                      <span className="text-sm font-medium truncate">{player?.name ?? "?"}</span>
                      {inPromoteZone && <ArrowUp className="w-3 h-3 text-secondary shrink-0" />}
                      {inRelegateZone && <ArrowDown className="w-3 h-3 text-destructive shrink-0" />}
                    </div>
                    <span className="w-8 text-center text-xs text-muted-foreground">{s.played}</span>
                    <span className="w-8 text-center text-xs text-muted-foreground">{s.won}</span>
                    <span className="w-14 text-center text-xs text-muted-foreground font-mono">{s.legsFor}:{s.legsAgainst}</span>
                    <span className="w-10 text-right font-display text-primary">{s.points}</span>
                  </div>
                );
              })}
              <ListPaginationFooter list={pagedStandings} />
            </div>
          )}
        </SectionCard>

        <SectionCard>
          <Eyebrow icon={Users}>{t("league.fixturesTitle")}</Eyebrow>
          {fixturesByRound.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("league.noFixturesYet")}</p>
          ) : (
            <div className="space-y-4">
              {fixturesByRound.map(([round, roundFixtures]) => {
                const scheduledDate = roundFixtures[0].scheduled_date;
                const isOrganizer = activeLeague.created_by === session?.user?.id;
                return (
                <div key={round}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t("league.roundLabel")} {round}{legLabel(roundFixtures[0].leg) ? ` · ${legLabel(roundFixtures[0].leg)}` : ""}
                    </p>
                    {/* Round 3 Rang 10: a Spieltag is scheduled as a whole round, not per fixture —
                        see setRoundScheduledDate's doc comment. Read-only date text for everyone
                        else once a date is set; only the league's organizer gets the editable
                        input (same creator-only gate as the league edit/delete buttons above). */}
                    {isOrganizer ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <CalendarDays className="w-3 h-3 text-muted-foreground" />
                        <Input
                          type="date"
                          value={scheduledDate ?? ""}
                          disabled={savingRoundDate === round}
                          onChange={(e) => setRoundScheduledDate(round, e.target.value)}
                          className="h-6 w-[130px] text-[10px] px-1.5 bg-muted border-border"
                        />
                      </div>
                    ) : scheduledDate ? (
                      <p className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                        <CalendarDays className="w-3 h-3" />
                        {new Date(scheduledDate).toLocaleDateString(LOCALE_BY_LANGUAGE[language], { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}
                      </p>
                    ) : null}
                    {/* Calendar export (2026-09-09) — shown to EVERYONE once a date is set, not
                        just the organizer (unlike the editable date input above): any participant
                        might want this specific matchday in their own phone's calendar, and this
                        is a pure client-side download, nothing to save back. */}
                    {scheduledDate && (
                      <Button
                        size="icon" variant="ghost" className="h-6 w-6 shrink-0"
                        title={t("league.addToCalendar")}
                        onClick={() => downloadIcsEvent(
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
                        )}
                      >
                        <CalendarPlus className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {roundFixtures.map((f) => {
                      const p1 = playerById.get(f.player1_id);
                      const p2 = playerById.get(f.player2_id);
                      return (
                        <div key={f.id} className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0 flex items-center justify-between gap-2 text-sm">
                            <span className={`truncate ${f.winner_id === f.player1_id ? "font-semibold text-primary" : ""}`}>{p1?.emoji} {p1?.name ?? "?"}</span>
                            {f.status === "finished" ? (
                              <span className="text-xs font-mono text-muted-foreground shrink-0">{f.player1_legs_won}:{f.player2_legs_won}</span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground shrink-0">vs</span>
                            )}
                            <span className={`truncate text-right ${f.winner_id === f.player2_id ? "font-semibold text-primary" : ""}`}>{p2?.name ?? "?"} {p2?.emoji}</span>
                          </div>
                          {f.status === "pending" && (
                            activeLeague.result_mode === "live" ? (
                              <>
                                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" onClick={() => startFixtureGame(f)}>
                                  <Play className="w-3 h-3" /> {t("league.playBtn")}
                                </Button>
                                {session?.user?.id && [p1?.user_id, p2?.user_id].includes(session.user.id) && p1?.user_id && p2?.user_id && (
                                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" disabled={startingOnlineId === f.id} onClick={() => startFixtureOnline(f)}>
                                    {startingOnlineId === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />} {t("game.setupOnline")}
                                  </Button>
                                )}
                              </>
                            ) : (
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" onClick={() => openManualEntry(f)}>
                                <Pencil className="w-3 h-3" /> {t("league.enterResultBtn")}
                              </Button>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        <Dialog open={!!manualEntryFixture} onOpenChange={(open) => !open && setManualEntryFixture(null)}>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-display uppercase">{t("league.enterResultDialogTitle")}</DialogTitle>
            </DialogHeader>
            {manualEntryFixture && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 items-end">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block truncate">
                      {playerById.get(manualEntryFixture.player1_id)?.name ?? t("league.player1Label")}
                    </label>
                    <Input type="number" min={0} value={manualP1Legs} onChange={(e) => setManualP1Legs(e.target.value)} className="bg-muted border-border" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block truncate">
                      {playerById.get(manualEntryFixture.player2_id)?.name ?? t("league.player2Label")}
                    </label>
                    <Input type="number" min={0} value={manualP2Legs} onChange={(e) => setManualP2Legs(e.target.value)} className="bg-muted border-border" />
                  </div>
                </div>
                {manualP1Legs !== "" && manualP2Legs !== "" && manualP1Legs === manualP2Legs && (
                  <p className="text-xs text-destructive">{t("league.noDrawAllowedMsg")}</p>
                )}
                <Button
                  className="w-full gap-1.5"
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

  // ─── LIST + CREATE ───────────────────────────────
  return (
    <div className="container py-6 animate-slide-up max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Swords className="w-6 h-6 text-accent" />
          <h2 className="text-2xl font-display uppercase">{t("league.pageTitle")}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/tournament" className="text-xs text-muted-foreground hover:text-foreground">← {t("league.tournamentsLink")}</Link>
          <Button size="sm" onClick={() => (creating ? resetForm() : setCreating(true))} className="gap-1">
            <Plus className="w-4 h-4" /> {creating ? t("common.cancel") : t("league.newLeagueBtn")}
          </Button>
        </div>
      </div>

      {creating && (
        <SectionCard glow="primary" className="mb-4 space-y-3">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t("common.name")}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("league.namePlaceholder")} className="bg-muted border-border" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {!editingLeagueId && (
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">{t("league.formatLabel")}</label>
                <Select value={format} onValueChange={(v) => setFormat(v as "single" | "double")}>
                  <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="single">{t("league.singleRoundLabel")}</SelectItem>
                    <SelectItem value="double">{t("league.doubleRoundLabel")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t("league.resultModeLabel")}</label>
              <Select value={resultMode} onValueChange={(v) => setResultMode(v as "live" | "manual")}>
                <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="live">{t("league.liveModeOption")}</SelectItem>
                  <SelectItem value="manual">{t("league.manualModeOption")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t("league.gameModeLabel")}</label>
              <Select value={gameMode} onValueChange={setGameMode}>
                <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="501">501</SelectItem>
                  <SelectItem value="301">301</SelectItem>
                  <SelectItem value="Cricket">Cricket</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">{t("tournament.firstToLegsLabel")}</label>
              <Select value={String(bestOfLegs)} onValueChange={(v) => setBestOfLegs(Number(v))}>
                <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {BEST_OF_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{t("stats.firstTo")} {Math.ceil(n / 2)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {editingLeagueId ? (
            <p className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-2.5">
              {t("league.editRestrictionNotice")}
            </p>
          ) : (
            <>
              {/* Saison-Liga mit Auf-/Abstieg (2026-09-10) — opt-in toggle, only offered at
                  creation time (see the state declarations' own doc comment for why). */}
              <label className="flex items-center justify-between gap-3 px-1 py-1 rounded-lg cursor-pointer">
                <span className="flex items-center gap-2 text-sm">
                  <Layers className="w-4 h-4 text-primary shrink-0" />
                  {t("league.seasonLigaToggleLabel")}
                </span>
                <Switch checked={seasonLigaMode} onCheckedChange={setSeasonLigaMode} />
              </label>
              {seasonLigaMode && (
                <p className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-2.5 -mt-1">
                  {t("league.seasonLigaExplainer")}
                </p>
              )}

              {seasonLigaMode ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">{t("league.swapCountLabel")}</label>
                    <Select value={String(swapCount)} onValueChange={(v) => setSwapCount(Number(v))}>
                      <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        {[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {divisions.map((d, idx) => (
                    <div key={idx} className="border border-border rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-display uppercase text-muted-foreground shrink-0">{t("league.divisionLabel")} {idx + 1}</span>
                        <Input
                          value={d.name}
                          onChange={(e) => renameDivision(idx, e.target.value)}
                          className="h-8 bg-muted border-border text-sm flex-1"
                        />
                        {divisions.length > 2 && (
                          <button onClick={() => removeDivision(idx)} className="text-muted-foreground hover:text-destructive shrink-0 p-1">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{t("league.participantsLabel")} ({d.participantIds.size})</p>
                      <div className="space-y-1 max-h-[22vh] overflow-y-auto -mx-1 px-1">
                        {dbPlayers.map((p) => (
                          <label key={p.id} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer">
                            <Checkbox checked={d.participantIds.has(p.id)} onCheckedChange={() => toggleDivisionParticipant(idx, p.id)} />
                            <span className="text-base shrink-0">{p.emoji}</span>
                            <span className="flex-1 min-w-0 truncate text-xs">{p.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addDivision} className="w-full gap-1">
                    <Plus className="w-3.5 h-3.5" /> {t("league.addDivisionBtn")}
                  </Button>
                </div>
              ) : (
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">{t("league.participantsLabel")} ({selectedParticipants.size})</label>
                  <div className="space-y-1 max-h-[40vh] overflow-y-auto -mx-1 px-1">
                    {dbPlayers.map((p) => (
                      <label key={p.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                        <Checkbox checked={selectedParticipants.has(p.id)} onCheckedChange={() => toggleParticipant(p.id)} />
                        <span className="text-lg shrink-0">{p.emoji}</span>
                        <span className="flex-1 min-w-0 truncate text-sm">{p.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <Button
            onClick={editingLeagueId ? saveLeagueEdit : createLeague}
            className="w-full"
            disabled={
              !name.trim() || savingLeague ||
              (!editingLeagueId && (seasonLigaMode
                ? divisions.some((d) => !d.name.trim() || d.participantIds.size < 2)
                : selectedParticipants.size < 2))
            }
          >
            {savingLeague ? t("league.savingBtn") : editingLeagueId ? t("league.saveChangesBtn") : t("league.createLeagueBtn")}
          </Button>
        </SectionCard>
      )}

      {loading || playersLoading ? (
        <div role="status" aria-label={t("common.loading")} className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : leagues.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Swords className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t("league.noLeaguesYet")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pagedLeagues.visible.map((l) => (
            <div key={l.id} className="gradient-card border border-border shadow-elevation-sm rounded-xl p-4 flex items-center gap-3 hover:border-primary/40 transition-colors">
              <Link to={`/leagues/${l.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
                  <Swords className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{l.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {l.participant_ids.length} {t("league.participantsSuffix")} · {l.format === "double" ? t("league.doubleRoundLabel") : t("league.singleRoundLabel")} · {l.status === "finished" ? t("league.finishedStatusLabel") : t("league.activeStatusLabel")}
                    {/* Saison-Liga mit Auf-/Abstieg (2026-09-10) — only shown once it's actually
                        relevant (a division, or past season 1), so a plain league's row is
                        unchanged from before this feature existed. */}
                    {(l.division_name || l.season_number > 1) && (
                      <> · {l.division_name ?? `${t("league.divisionLabel")} ${l.division_level}`}{l.season_number > 1 ? ` · ${t("league.seasonLabel")} ${l.season_number}` : ""}</>
                    )}
                  </p>
                </div>
              </Link>
              {l.created_by === session?.user?.id && (
                <div className="flex items-center shrink-0">
                  <Button variant="ghost" size="icon" title={t("league.editLeagueBtn")} aria-label={t("league.editLeagueBtn")} onClick={() => startEditLeague(l)}>
                    <Pencil className="w-4 h-4 text-muted-foreground hover:text-primary" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" title={t("league.deleteLeagueBtn")} aria-label={t("league.deleteLeagueBtn")}>
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
                </div>
              )}
            </div>
          ))}
          <ListPaginationFooter list={pagedLeagues} />
        </div>
      )}
    </div>
  );
};

export default LeaguePage;
