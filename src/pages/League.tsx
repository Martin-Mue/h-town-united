import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Trophy, Plus, ArrowLeft, Play, Pencil, Trash2, Check, Loader2, Users, Swords, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { useToast } from "@/hooks/use-toast";
import { fetchClubPlayers, type ClubPlayer } from "@/lib/repositories/players";
import { generateRoundRobinFixtures } from "@/utils/roundRobin";
import { SectionCard, Eyebrow, RankBadge, RankAvatar } from "@/components/stats/StatPrimitives";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";

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
}

const BEST_OF_OPTIONS = [1, 3, 5, 7];

/** Structured round-robin competition with an auto-generated fixture list — distinct from ad-hoc
 *  Tournament brackets (elimination) and TournamentSeries (points across separately-run
 *  tournaments). Two views in one component, same pattern as TournamentSeries.tsx: list+create
 *  when no :id, standings+fixtures when there is one. */
const LeaguePage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { clubId } = useClubBranding();
  const { toast } = useToast();

  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [dbPlayers, setDbPlayers] = useState<ClubPlayer[]>([]);
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

  const [manualEntryFixture, setManualEntryFixture] = useState<FixtureRow | null>(null);
  const [manualP1Legs, setManualP1Legs] = useState("");
  const [manualP2Legs, setManualP2Legs] = useState("");
  const [savingResult, setSavingResult] = useState(false);

  const fetchAll = useCallback(async () => {
    const [l, p] = await Promise.all([
      supabase.from("leagues").select("*").order("created_at", { ascending: false }),
      fetchClubPlayers(),
    ]);
    if (l.data) setLeagues(l.data as unknown as LeagueRow[]);
    setDbPlayers(p);
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

  const playerById = useMemo(() => new Map(dbPlayers.map((p) => [p.id, p])), [dbPlayers]);

  const standings = useMemo(() => {
    if (!activeLeague) return [];
    const map = new Map<string, { playerId: string; played: number; won: number; lost: number; points: number; legsFor: number; legsAgainst: number }>();
    activeLeague.participant_ids.forEach((pid) => map.set(pid, { playerId: pid, played: 0, won: 0, lost: 0, points: 0, legsFor: 0, legsAgainst: 0 }));
    fixtures.filter((f) => f.status === "finished").forEach((f) => {
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
  };

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
      toast({ title: "Liga aktualisiert" });
      resetForm();
      await fetchAll();
    } catch (err: unknown) {
      toast({ title: "Fehler", description: err instanceof Error ? err.message : "Änderungen konnten nicht gespeichert werden.", variant: "destructive" });
    } finally {
      setSavingLeague(false);
    }
  };

  const createLeague = async () => {
    if (!name.trim() || selectedParticipants.size < 2 || !session?.user?.id || savingLeague) return;
    setSavingLeague(true);
    try {
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

      const generated = generateRoundRobinFixtures(participantIds, format);
      const { error: fxError } = await supabase.from("league_fixtures").insert(
        generated.map((f) => ({
          league_id: league.id, club_id: clubId, round_number: f.round, leg: f.leg,
          player1_id: f.player1Id, player2_id: f.player2Id,
        }))
      );
      if (fxError) throw fxError;

      toast({ title: "Liga erstellt", description: `${generated.length} Partien im Spielplan.` });
      resetForm();
      await fetchAll();
      navigate(`/leagues/${league.id}`);
    } catch (err: unknown) {
      toast({ title: "Fehler", description: err instanceof Error ? err.message : "Liga konnte nicht erstellt werden.", variant: "destructive" });
    } finally {
      setSavingLeague(false);
    }
  };

  const deleteLeague = async (leagueId: string) => {
    try {
      const { error } = await supabase.from("leagues").delete().eq("id", leagueId);
      if (error) throw error;
      toast({ title: "Liga gelöscht" });
      await fetchAll();
    } catch (err: unknown) {
      toast({ title: "Fehler", description: err instanceof Error ? err.message : "Liga konnte nicht gelöscht werden.", variant: "destructive" });
    }
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
      navigate(`/game?online=${created.id}`);
    } catch (err: unknown) {
      toast({ title: "Fehler", description: err instanceof Error ? err.message : "Online-Match konnte nicht gestartet werden.", variant: "destructive" });
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
    try {
      const { error } = await supabase.from("league_fixtures").update({
        status: "finished",
        winner_id: l1 > l2 ? manualEntryFixture.player1_id : manualEntryFixture.player2_id,
        player1_legs_won: l1,
        player2_legs_won: l2,
        played_at: new Date().toISOString(),
      }).eq("id", manualEntryFixture.id);
      if (error) throw error;
      setManualEntryFixture(null);
      await fetchFixtures();
    } catch (err: unknown) {
      toast({ title: "Fehler", description: err instanceof Error ? err.message : "Ergebnis konnte nicht gespeichert werden.", variant: "destructive" });
    } finally {
      setSavingResult(false);
    }
  };

  const legLabel = (leg: FixtureRow["leg"]) => leg === "first" ? "Hinrunde" : leg === "return" ? "Rückrunde" : null;

  // ─── SINGLE LEAGUE DETAIL ────────────────────────
  if (id && activeLeague) {
    return (
      <div className="container py-6 animate-slide-up max-w-3xl mx-auto">
        <Link to="/leagues" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Alle Ligen
        </Link>

        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <Swords className="w-6 h-6 text-accent" />
            <h2 className="text-2xl font-display uppercase">{activeLeague.name}</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {activeLeague.game_mode} · First to {Math.ceil(activeLeague.best_of_legs / 2)} · {activeLeague.format === "double" ? "Hin- und Rückrunde" : "Einfachrunde"} ·{" "}
            {activeLeague.result_mode === "live" ? "Live-Spiele" : "Manuelle Eingabe"}
          </p>
        </div>

        <SectionCard className="mb-4">
          <Eyebrow icon={Trophy}>Tabelle</Eyebrow>
          {standings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Teilnehmer.</p>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-2 px-3 text-[10px] text-muted-foreground uppercase mb-1">
                <span className="w-6" />
                <span />
                <span className="w-8 text-center">Sp</span>
                <span className="w-8 text-center">S</span>
                <span className="w-14 text-center">Legs</span>
                <span className="w-10 text-right">Pkt</span>
              </div>
              {pagedStandings.visible.map((s) => {
                const i = standings.indexOf(s);
                const player = playerById.get(s.playerId);
                return (
                  <div key={s.playerId} className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-2 px-3 py-2 rounded-lg ${i < 3 ? "bg-muted/50" : "bg-muted/30"}`}>
                    <RankBadge rank={i + 1} />
                    <div className="flex items-center gap-2 min-w-0">
                      <RankAvatar emoji={player?.emoji ?? "🎯"} rank={i + 1} size={26} />
                      <span className="text-sm font-medium truncate">{player?.name ?? "?"}</span>
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
          <Eyebrow icon={Users}>Spielplan</Eyebrow>
          {fixturesByRound.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Partien.</p>
          ) : (
            <div className="space-y-4">
              {fixturesByRound.map(([round, roundFixtures]) => (
                <div key={round}>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                    Runde {round}{legLabel(roundFixtures[0].leg) ? ` · ${legLabel(roundFixtures[0].leg)}` : ""}
                  </p>
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
                                  <Play className="w-3 h-3" /> Spielen
                                </Button>
                                {session?.user?.id && [p1?.user_id, p2?.user_id].includes(session.user.id) && p1?.user_id && p2?.user_id && (
                                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" disabled={startingOnlineId === f.id} onClick={() => startFixtureOnline(f)}>
                                    {startingOnlineId === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />} Online
                                  </Button>
                                )}
                              </>
                            ) : (
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" onClick={() => openManualEntry(f)}>
                                <Pencil className="w-3 h-3" /> Eintragen
                              </Button>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <Dialog open={!!manualEntryFixture} onOpenChange={(open) => !open && setManualEntryFixture(null)}>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-display uppercase">Ergebnis eintragen</DialogTitle>
            </DialogHeader>
            {manualEntryFixture && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 items-end">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block truncate">
                      {playerById.get(manualEntryFixture.player1_id)?.name ?? "Spieler 1"}
                    </label>
                    <Input type="number" min={0} value={manualP1Legs} onChange={(e) => setManualP1Legs(e.target.value)} className="bg-muted border-border" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block truncate">
                      {playerById.get(manualEntryFixture.player2_id)?.name ?? "Spieler 2"}
                    </label>
                    <Input type="number" min={0} value={manualP2Legs} onChange={(e) => setManualP2Legs(e.target.value)} className="bg-muted border-border" />
                  </div>
                </div>
                {manualP1Legs !== "" && manualP2Legs !== "" && manualP1Legs === manualP2Legs && (
                  <p className="text-xs text-destructive">Unentschieden ist nicht möglich — es muss einen Sieger geben.</p>
                )}
                <Button
                  className="w-full gap-1.5"
                  disabled={savingResult || manualP1Legs === "" || manualP2Legs === "" || manualP1Legs === manualP2Legs}
                  onClick={submitManualResult}
                >
                  {savingResult ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Speichern
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
          <h2 className="text-2xl font-display uppercase">Liga-Modus</h2>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/tournament" className="text-xs text-muted-foreground hover:text-foreground">← Turniere</Link>
          <Button size="sm" onClick={() => (creating ? resetForm() : setCreating(true))} className="gap-1">
            <Plus className="w-4 h-4" /> {creating ? "Abbrechen" : "Neue Liga"}
          </Button>
        </div>
      </div>

      {creating && (
        <SectionCard glow="primary" className="mb-4 space-y-3">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Herbstliga 2026" className="bg-muted border-border" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {!editingLeagueId && (
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Format</label>
                <Select value={format} onValueChange={(v) => setFormat(v as "single" | "double")}>
                  <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="single">Einfachrunde</SelectItem>
                    <SelectItem value="double">Hin- und Rückrunde</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Ergebnisse</label>
              <Select value={resultMode} onValueChange={(v) => setResultMode(v as "live" | "manual")}>
                <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="live">Live gespielt</SelectItem>
                  <SelectItem value="manual">Manuell eingetragen</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Spielmodus</label>
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
              <label className="text-sm text-muted-foreground mb-1 block">First to Legs</label>
              <Select value={String(bestOfLegs)} onValueChange={(v) => setBestOfLegs(Number(v))}>
                <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {BEST_OF_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>First to {Math.ceil(n / 2)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {editingLeagueId ? (
            <p className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-2.5">
              Format und Teilnehmer sind nach dem Erstellen nicht mehr änderbar, da der Spielplan bereits danach erzeugt wurde. Für eine andere Zusammensetzung: Liga löschen und neu anlegen.
            </p>
          ) : (
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">Teilnehmer ({selectedParticipants.size})</label>
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

          <Button
            onClick={editingLeagueId ? saveLeagueEdit : createLeague}
            className="w-full"
            disabled={!name.trim() || (!editingLeagueId && selectedParticipants.size < 2) || savingLeague}
          >
            {savingLeague ? "Speichert…" : editingLeagueId ? "Änderungen speichern" : "Liga erstellen"}
          </Button>
        </SectionCard>
      )}

      {loading ? (
        <div role="status" aria-label="Lädt …" className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : leagues.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Swords className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Noch keine Ligen. Erstelle die erste!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pagedLeagues.visible.map((l) => (
            <div key={l.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 hover:border-primary/40 transition-colors">
              <Link to={`/leagues/${l.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
                  <Swords className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{l.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {l.participant_ids.length} Teilnehmer · {l.format === "double" ? "Hin- und Rückrunde" : "Einfachrunde"} · {l.status === "finished" ? "Beendet" : "Aktiv"}
                  </p>
                </div>
              </Link>
              {l.created_by === session?.user?.id && (
                <div className="flex items-center shrink-0">
                  <Button variant="ghost" size="icon" title="Liga bearbeiten" aria-label="Liga bearbeiten" onClick={() => startEditLeague(l)}>
                    <Pencil className="w-4 h-4 text-muted-foreground hover:text-primary" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" title="Liga löschen" aria-label="Liga löschen">
                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Liga löschen?</AlertDialogTitle>
                        <AlertDialogDescription>
                          „{l.name}" wird unwiderruflich gelöscht, inklusive des gesamten Spielplans. Bereits gespielte Partien selbst bleiben in der Statistik erhalten.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteLeague(l.id)}>Löschen</AlertDialogAction>
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
