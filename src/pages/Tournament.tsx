import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from "react";
import { Trophy, Plus, Play, RotateCcw, Trash2, Loader2, Users, Check, Sparkles, Layers, Radio, Copy, Zap, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import TrophyCeremony from "@/components/tournament/TrophyCeremony";
import { Link } from "react-router-dom";

interface Match {
  id: string;
  round: number;
  position: number;
  player1?: string;
  player2?: string;
  winner?: string;
  score1?: number;
  score2?: number;
  table?: number;
}
interface RoundConfig {
  mode: string;      // "501" | "301" | "Cricket" | "Extern"
  bestOf: number;    // best-of legs
}

interface SeriesRecord {
  id: string;
  name: string;
}

interface RoundRobinMatch {
  id: string;
  player1: string;
  player2: string;
  winner?: string;
  played: boolean;
}

interface RoundRobinStanding {
  name: string;
  played: number;
  won: number;
  lost: number;
  points: number;
}

interface TournamentRecord {
  id: string;
  name: string;
  mode: string;
  status: string;
  champion: string | null;
  players: string[];
  bracket: Match[] | RoundRobinMatch[];
  created_at: string;
  game_mode?: string;
  best_of_legs?: number;
  series_id?: string | null;
  round_configs?: RoundConfig[];
  public_view?: boolean;
  public_slug?: string | null;
}

const BRACKET_SIZES = [4, 8, 16, 32, 64];

const nextPowerOfTwo = (count: number) => Math.pow(2, Math.ceil(Math.log2(Math.max(count, 2))));

const shuffle = <T,>(list: T[]) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const TournamentPage = () => {
  const [phase, setPhase] = useState<"list" | "setup" | "bracket">("list");
  const [tournaments, setTournaments] = useState<TournamentRecord[]>([]);
  const [activeTournament, setActiveTournament] = useState<TournamentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [ceremonyChampion, setCeremonyChampion] = useState<string | null>(null);
  const [seenCeremonyFor, setSeenCeremonyFor] = useState<string | null>(null);
  const [publicToggling, setPublicToggling] = useState(false);

  // Setup state
  const [tournamentName, setTournamentName] = useState("");
  const [tournamentMode, setTournamentMode] = useState("event-ko");
  const [gameMode, setGameMode] = useState("501");
  const [bestOfLegs, setBestOfLegs] = useState(3);
  const [targetSize, setTargetSize] = useState("64");
  const [seriesId, setSeriesId] = useState<string>("none");
  const [seriesList, setSeriesList] = useState<SeriesRecord[]>([]);
  const [roundConfigs, setRoundConfigs] = useState<RoundConfig[]>([]);
  const [playerInput, setPlayerInput] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [players, setPlayers] = useState<string[]>([]);
  const [dbPlayers, setDbPlayers] = useState<{ id: string; name: string; emoji: string }[]>([]);

  const { session } = useAuth();
  const { toast } = useToast();

  const togglePublicView = async () => {
    if (!activeTournament) return;
    setPublicToggling(true);
    const next = !activeTournament.public_view;
    let slug = activeTournament.public_slug;
    if (next && !slug) {
      slug = `${activeTournament.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "turnier"}-${activeTournament.id.slice(0, 6)}`;
    }
    const { error } = await (supabase as any).from("tournaments").update({
      public_view: next, public_slug: slug,
    }).eq("id", activeTournament.id);
    if (error) {
      toast({ title: "Fehler", description: "Öffentliche Ansicht konnte nicht geändert werden.", variant: "destructive" });
    } else {
      setActiveTournament({ ...activeTournament, public_view: next, public_slug: slug });
      toast({ title: next ? "Live-Ansicht aktiv" : "Live-Ansicht deaktiviert", description: next && slug ? `${window.location.origin}/live/${slug}` : undefined });
    }
    setPublicToggling(false);
  };

  const copyPublicLink = () => {
    if (!activeTournament?.public_slug) return;
    const url = `${window.location.origin}/live/${activeTournament.public_slug}`;
    navigator.clipboard.writeText(url).then(() => toast({ title: "Link kopiert", description: url }));
  };

  const fetchTournaments = useCallback(async () => {
    const { data } = await supabase
      .from("tournaments")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) {
      setTournaments(data.map(t => ({
        ...t,
        players: (t.players as any) || [],
        bracket: (t.bracket as any) || [],
        game_mode: (t as any).game_mode || "501",
        best_of_legs: (t as any).best_of_legs || 3,
        series_id: (t as any).series_id || null,
        round_configs: ((t as any).round_configs as RoundConfig[]) || [],
        public_view: (t as any).public_view || false,
        public_slug: (t as any).public_slug || null,
      })) as TournamentRecord[]);
    }
    setLoading(false);
  }, []);

  const fetchDbPlayers = useCallback(async () => {
    const { data } = await supabase.from("players").select("id, name, emoji").order("name");
    if (data) setDbPlayers(data);
  }, []);

  const fetchSeries = useCallback(async () => {
    const { data } = await supabase.from("tournament_series" as any).select("id, name").order("created_at", { ascending: false });
    if (data) setSeriesList(data as any);
  }, []);

  useEffect(() => { fetchTournaments(); fetchDbPlayers(); fetchSeries(); }, [fetchTournaments, fetchDbPlayers, fetchSeries]);

  // Auto-generate round configs when target size or defaults change
  useEffect(() => {
    if (tournamentMode === "round-robin") return;
    const size = Number(targetSize) || 64;
    const totalRounds = Math.log2(nextPowerOfTwo(size));
    setRoundConfigs((prev) => {
      const next: RoundConfig[] = [];
      for (let i = 0; i < totalRounds; i++) {
        next.push(prev[i] || { mode: gameMode, bestOf: bestOfLegs });
      }
      return next;
    });
  }, [targetSize, tournamentMode, gameMode, bestOfLegs]);

  const addPlayers = (names: string[]) => {
    const cleaned = names.map((name) => name.trim()).filter(Boolean);
    setPlayers((prev) => [...prev, ...cleaned.filter((name) => !prev.includes(name))].slice(0, 64));
  };

  const addPlayer = () => {
    addPlayers([playerInput]);
    setPlayerInput("");
  };

  const addDbPlayer = (name: string) => {
    addPlayers([name]);
  };

  const addBulkPlayers = () => {
    addPlayers(bulkInput.split(/[\n,;]+/));
    setBulkInput("");
  };

  const fillGuestPlayers = () => {
    const target = Number(targetSize) || 64;
    const needed = Math.max(0, target - players.length);
    addPlayers(Array.from({ length: needed }, (_, i) => `Gast ${String(players.length + i + 1).padStart(2, "0")}`));
  };

  const removePlayer = (name: string) => setPlayers(players.filter(p => p !== name));

  // ─── KO Bracket Generation ──────────────────────
  const generateKoBracket = (playerList: string[]): Match[] => {
    const requestedSize = Number(targetSize) || nextPowerOfTwo(playerList.length);
    const size = Math.min(64, Math.max(nextPowerOfTwo(playerList.length), requestedSize));
    const padded = shuffle(playerList).slice(0, size);
    while (padded.length < size) padded.push("BYE");

    const firstRound: Match[] = [];
    for (let i = 0; i < padded.length; i += 2) {
      firstRound.push({
        id: `r1-${i / 2}`,
        round: 1,
        position: i / 2,
        table: i / 2 + 1,
        player1: padded[i],
        player2: padded[i + 1],
        winner: padded[i + 1] === "BYE" ? padded[i] : padded[i] === "BYE" ? padded[i + 1] : undefined,
      });
    }

    const totalRounds = Math.log2(size);
    const allMatches = [...firstRound];
    for (let round = 2; round <= totalRounds; round++) {
      const count = size / Math.pow(2, round);
      for (let pos = 0; pos < count; pos++) {
        allMatches.push({ id: `r${round}-${pos}`, round, position: pos, table: pos + 1 });
      }
    }
    propagateKoWinners(allMatches);
    return allMatches;
  };

  const propagateKoWinners = (allMatches: Match[]) => {
    const totalRounds = Math.max(...allMatches.map(m => m.round));
    for (let round = 1; round < totalRounds; round++) {
      const roundMatches = allMatches.filter(m => m.round === round);
      const nextRound = allMatches.filter(m => m.round === round + 1);
      roundMatches.forEach((match, idx) => {
        if (match.winner) {
          const next = nextRound[Math.floor(idx / 2)];
          if (next) {
            if (idx % 2 === 0) next.player1 = match.winner;
            else next.player2 = match.winner;
          }
        }
      });
    }
  };

  // ─── Round Robin Generation ─────────────────────
  const generateRoundRobin = (playerList: string[]): RoundRobinMatch[] => {
    const matches: RoundRobinMatch[] = [];
    let id = 0;
    for (let i = 0; i < playerList.length; i++) {
      for (let j = i + 1; j < playerList.length; j++) {
        matches.push({ id: `rr-${id++}`, player1: playerList[i], player2: playerList[j], played: false });
      }
    }
    return shuffle(matches);
  };

  // ─── Start Tournament ──────────────────────────
  const startTournament = async () => {
    if (players.length < 2) return;
    const bracket = tournamentMode === "round-robin" ? generateRoundRobin(players) : generateKoBracket(players);

    const { data, error } = await supabase.from("tournaments").insert({
      name: tournamentName || "Großevent",
      mode: tournamentMode,
      game_mode: gameMode,
      best_of_legs: bestOfLegs,
      user_id: session?.user?.id,
      players: players as any,
      bracket: bracket as any,
      status: "active",
      series_id: seriesId === "none" ? null : seriesId,
      round_configs: roundConfigs as any,
    }).select().single();

    if (error || !data) {
      toast({ title: "Fehler", description: "Turnier konnte nicht erstellt werden.", variant: "destructive" });
      return;
    }

    const record: TournamentRecord = { ...data, players: data.players as any, bracket: data.bracket as any, game_mode: (data as any).game_mode || gameMode, best_of_legs: (data as any).best_of_legs || bestOfLegs, series_id: (data as any).series_id, round_configs: (data as any).round_configs || [] };
    setActiveTournament(record);
    setPhase("bracket");
    setPlayers([]);
    setTournamentName("");
    fetchTournaments();
  };

  // ─── KO: Set Winner ────────────────────────────
  const setKoWinner = async (matchId: string, winner: string, score1?: number, score2?: number) => {
    if (!activeTournament) return;
    const bracket = [...(activeTournament.bracket as Match[])];
    const updated = bracket.map(m => m.id === matchId ? { ...m, winner, score1, score2 } : m);

    const match = updated.find(m => m.id === matchId)!;
    const nextRound = updated.filter(m => m.round === match.round + 1);
    if (nextRound.length > 0) {
      const roundMatches = updated.filter(m => m.round === match.round);
      const idx = roundMatches.findIndex(m => m.id === matchId);
      const next = nextRound[Math.floor(idx / 2)];
      if (next) {
        if (idx % 2 === 0) next.player1 = winner;
        else next.player2 = winner;
      }
    }

    const totalRounds = Math.max(...updated.map(m => m.round));
    const finalMatch = updated.find(m => m.round === totalRounds);
    const champion = finalMatch?.winner || null;

    await supabase.from("tournaments").update({
      bracket: updated as any,
      champion,
      status: champion ? "finished" : "active",
    }).eq("id", activeTournament.id);

    setActiveTournament({ ...activeTournament, bracket: updated, champion });
    if (champion && seenCeremonyFor !== activeTournament.id) {
      setCeremonyChampion(champion);
      setSeenCeremonyFor(activeTournament.id);
    }
  };

  const setKoScore = async (matchId: string, slot: 1 | 2) => {
    if (!activeTournament) return;
    const match = (activeTournament.bracket as Match[]).find(m => m.id === matchId);
    if (!match || !match.player1 || !match.player2 || match.player1 === "BYE" || match.player2 === "BYE") return;
    const score1 = slot === 1 ? (match.score1 || 0) + 1 : (match.score1 || 0);
    const score2 = slot === 2 ? (match.score2 || 0) + 1 : (match.score2 || 0);
    const cfg = (activeTournament.round_configs || [])[match.round - 1];
    const bestOf = cfg?.bestOf || activeTournament.best_of_legs || 1;
    const legsToWin = Math.ceil(bestOf / 2);
    const winner = score1 >= legsToWin && score1 > score2 ? match.player1 : score2 >= legsToWin && score2 > score1 ? match.player2 : undefined;
    if (winner) await setKoWinner(matchId, winner, score1, score2);
    else {
      const bracket = (activeTournament.bracket as Match[]).map(m => m.id === matchId ? { ...m, score1, score2 } : m);
      await supabase.from("tournaments").update({ bracket: bracket as any }).eq("id", activeTournament.id);
      setActiveTournament({ ...activeTournament, bracket });
    }
  };

  const resetKoMatch = async (matchId: string) => {
    if (!activeTournament) return;
    const bracket = (activeTournament.bracket as Match[]).map(m => m.id === matchId ? { ...m, winner: undefined, score1: undefined, score2: undefined } : { ...m });
    propagateKoWinners(bracket);
    await supabase.from("tournaments").update({ bracket: bracket as any, champion: null, status: "active" }).eq("id", activeTournament.id);
    setActiveTournament({ ...activeTournament, bracket, champion: null, status: "active" });
  };

  // ─── Round Robin: Set Winner ───────────────────
  const setRrWinner = async (matchId: string, winner: string) => {
    if (!activeTournament) return;
    const bracket = (activeTournament.bracket as RoundRobinMatch[]).map(m =>
      m.id === matchId ? { ...m, winner, played: true } : m
    );

    const allPlayed = bracket.every(m => m.played);
    let champion: string | null = null;
    if (allPlayed) {
      const standings = calcStandings(bracket);
      champion = standings[0]?.name || null;
    }

    await supabase.from("tournaments").update({
      bracket: bracket as any,
      champion,
      status: champion ? "finished" : "active",
    }).eq("id", activeTournament.id);

    setActiveTournament({ ...activeTournament, bracket, champion });
    if (champion && seenCeremonyFor !== activeTournament.id) {
      setCeremonyChampion(champion);
      setSeenCeremonyFor(activeTournament.id);
    }
  };

  const calcStandings = (matches: RoundRobinMatch[]): RoundRobinStanding[] => {
    const map: Record<string, RoundRobinStanding> = {};
    matches.forEach(m => {
      [m.player1, m.player2].forEach(p => {
        if (!map[p]) map[p] = { name: p, played: 0, won: 0, lost: 0, points: 0 };
      });
      if (m.played && m.winner) {
        map[m.player1].played++;
        map[m.player2].played++;
        map[m.winner].won++;
        map[m.winner].points += 2;
        const loser = m.winner === m.player1 ? m.player2 : m.player1;
        map[loser].lost++;
      }
    });
    return Object.values(map).sort((a, b) => b.points - a.points || b.won - a.won);
  };

  const openTournament = (t: TournamentRecord) => {
    setActiveTournament(t);
    setPhase("bracket");
  };

  const deleteTournament = async (id: string) => {
    await supabase.from("tournaments").delete().eq("id", id);
    fetchTournaments();
    if (activeTournament?.id === id) { setActiveTournament(null); setPhase("list"); }
  };

  const roundLabel = (round: number, total: number) => {
    if (round === total) return "Finale";
    if (round === total - 1) return "Halbfinale";
    if (round === total - 2) return "Viertelfinale";
    return `Runde ${round}`;
  };

  // ─── LIST PHASE ─────────────────────────────────
  if (phase === "list") {
    return (
      <div className="container py-6 animate-slide-up">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Trophy className="w-6 h-6 text-accent" />
            <h2 className="text-2xl font-display uppercase">Turniere</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/tournaments/series" className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-border hover:border-accent/50 transition-colors">
              <Layers className="w-3.5 h-3.5" /> Serien
            </Link>
            <Button size="sm" onClick={() => setPhase("setup")} className="gap-1">
              <Plus className="w-4 h-4" /> Neues Turnier
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : tournaments.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Noch keine Turniere. Erstelle dein erstes!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tournaments.map(t => (
              <div key={t.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
                <button onClick={() => openTournament(t)} className="flex-1 text-left">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${t.status === "active" ? "bg-secondary animate-pulse" : t.status === "finished" ? "bg-accent" : "bg-muted-foreground"}`} />
                    <div>
                      <p className="font-semibold text-sm">{t.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="bg-muted px-1.5 py-0.5 rounded font-mono">{t.mode === "ko" ? "K.O." : "Round Robin"}</span>
                        <span><Users className="w-3 h-3 inline" /> {t.players.length}</span>
                        <span>{new Date(t.created_at).toLocaleDateString("de-DE")}</span>
                      </div>
                    </div>
                  </div>
                  {t.champion && <p className="text-xs text-accent mt-1">🏆 {t.champion}</p>}
                </button>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteTournament(t.id); }}>
                  <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── SETUP PHASE ────────────────────────────────
  if (phase === "setup") {
    return (
      <div className="container py-6 animate-slide-up max-w-3xl mx-auto">
        <Button variant="ghost" onClick={() => setPhase("list")} className="mb-4 text-muted-foreground text-sm">← Zurück</Button>
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-accent text-xs uppercase tracking-wider"><Sparkles className="w-4 h-4" /> Großevent-Modus</div>
          <h2 className="text-2xl font-display uppercase">Turnier erstellen</h2>
          <p className="text-sm text-muted-foreground">Für bis zu 64 Teilnehmer, Gastspieler und schnelle Ergebnis-Erfassung.</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Turniername</label>
            <Input value={tournamentName} onChange={(e) => setTournamentName(e.target.value)} placeholder="z.B. Vereinsmeisterschaft 2026" className="bg-card border-border" />
          </div>
          {seriesList.length > 0 && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> Turnierserie (optional)</label>
              <Select value={seriesId} onValueChange={setSeriesId}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="none">Keine Serie</SelectItem>
                  {seriesList.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Modus</label>
            <Select value={tournamentMode} onValueChange={setTournamentMode}>
              <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="ko">K.O.-System</SelectItem>
                <SelectItem value="event-ko">Event K.O. bis 64</SelectItem>
                <SelectItem value="round-robin">Jeder gegen Jeden</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Spielmodus</label>
              <Select value={gameMode} onValueChange={setGameMode}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="501">501</SelectItem>
                  <SelectItem value="301">301</SelectItem>
                  <SelectItem value="Cricket">Cricket</SelectItem>
                  <SelectItem value="Extern">Extern gespielt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Best of Legs</label>
              <Select value={String(bestOfLegs)} onValueChange={(v) => setBestOfLegs(Number(v))}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {[1, 3, 5, 7, 9, 11].map(n => <SelectItem key={n} value={String(n)}>Best of {n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {tournamentMode !== "round-robin" && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Turnierbaum-Größe</label>
              <Select value={targetSize} onValueChange={setTargetSize}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {BRACKET_SIZES.map(n => <SelectItem key={n} value={String(n)}>{n}er Baum</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {tournamentMode !== "round-robin" && roundConfigs.length > 0 && (
            <div className="bg-muted/30 border border-border rounded-xl p-3">
              <label className="text-sm text-muted-foreground mb-2 block flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> Modus pro Runde (Steigerung möglich)
              </label>
              <div className="space-y-2">
                {roundConfigs.map((cfg, idx) => {
                  const total = roundConfigs.length;
                  const label = idx === total - 1 ? "Finale" : idx === total - 2 ? "Halbfinale" : idx === total - 3 ? "Viertelfinale" : `Runde ${idx + 1}`;
                  return (
                    <div key={idx} className="grid grid-cols-[80px_1fr_1fr] gap-2 items-center">
                      <span className="text-xs font-display uppercase text-muted-foreground">{label}</span>
                      <Select value={cfg.mode} onValueChange={(v) => setRoundConfigs((prev) => prev.map((c, i) => i === idx ? { ...c, mode: v } : c))}>
                        <SelectTrigger className="bg-card border-border h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="501">501</SelectItem>
                          <SelectItem value="301">301</SelectItem>
                          <SelectItem value="Cricket">Cricket</SelectItem>
                          <SelectItem value="Extern">Extern</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={String(cfg.bestOf)} onValueChange={(v) => setRoundConfigs((prev) => prev.map((c, i) => i === idx ? { ...c, bestOf: Number(v) } : c))}>
                        <SelectTrigger className="bg-card border-border h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {[1, 3, 5, 7, 9, 11].map(n => <SelectItem key={n} value={String(n)}>Best of {n}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add from club members */}
          {dbPlayers.length > 0 && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Vereinsmitglieder hinzufügen</label>
              <div className="flex flex-wrap gap-2">
                {dbPlayers.filter(p => !players.includes(p.name)).map(p => (
                  <button key={p.id} onClick={() => addDbPlayer(p.name)}
                    className="bg-muted border border-border rounded-lg px-3 py-1 text-sm hover:border-primary/50 transition-colors">
                    {p.emoji} {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Manuell hinzufügen</label>
            <div className="flex gap-2">
              <Input value={playerInput} onChange={(e) => setPlayerInput(e.target.value)} placeholder="Name" className="bg-card border-border" onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
              <Button onClick={addPlayer} size="icon" variant="outline"><Plus className="w-4 h-4" /></Button>
            </div>
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Gastliste einfügen</label>
            <Textarea value={bulkInput} onChange={(e) => setBulkInput(e.target.value)} placeholder="Ein Name pro Zeile oder per Komma getrennt" />
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="outline" onClick={addBulkPlayers}>Liste übernehmen</Button>
              {tournamentMode !== "round-robin" && <Button size="sm" variant="outline" onClick={fillGuestPlayers}>Mit Gästen auffüllen</Button>}
            </div>
          </div>

          {players.length > 0 && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Teilnehmer ({players.length})</label>
              <div className="flex flex-wrap gap-2">
                {players.map(p => (
                  <button key={p} onClick={() => removePlayer(p)}
                    className="bg-card border border-border rounded-lg px-3 py-1 text-sm hover:border-destructive hover:text-destructive transition-colors group">
                    {p} <span className="text-muted-foreground group-hover:text-destructive ml-1">×</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button onClick={startTournament} className="w-full mt-4 font-display uppercase text-lg py-6" disabled={players.length < 2}>
            <Play className="w-5 h-5 mr-2" /> Turnier starten
          </Button>
        </div>
      </div>
    );
  }

  // ─── BRACKET PHASE ──────────────────────────────
  if (!activeTournament) return null;
  const isKo = activeTournament.mode !== "round-robin";

  if (isKo) {
    const matches = activeTournament.bracket as Match[];
    const totalRounds = matches.length > 0 ? Math.max(...matches.map(m => m.round)) : 0;

    return (
      <div className="py-4 animate-slide-up">
        <div className="container flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-display uppercase">{activeTournament.name}</h2>
            <p className="text-xs text-muted-foreground">{activeTournament.mode === "event-ko" ? "Event K.O." : "K.O.-System"} · {activeTournament.players.length} Spieler · {activeTournament.game_mode} · Best of {activeTournament.best_of_legs}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={activeTournament.public_view ? "default" : "outline"} size="sm" onClick={togglePublicView} disabled={publicToggling} className="gap-1">
              <Radio className={`w-3.5 h-3.5 ${activeTournament.public_view ? "animate-pulse" : ""}`} />
              {activeTournament.public_view ? "Live an" : "Live-Ansicht"}
            </Button>
            {activeTournament.public_view && activeTournament.public_slug && (
              <Button variant="outline" size="sm" onClick={copyPublicLink} className="gap-1" title="Link kopieren">
                <Copy className="w-3.5 h-3.5" /> Link
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => { setActiveTournament(null); setPhase("list"); }}>
              ← Übersicht
            </Button>
          </div>
        </div>

        {activeTournament.public_view && activeTournament.public_slug && (
          <div className="container mb-4">
            <div className="bg-gradient-to-r from-secondary/10 via-primary/10 to-accent/10 border border-secondary/30 rounded-xl px-4 py-2 text-xs flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-secondary animate-pulse" />
              <span className="text-muted-foreground">Beamer-Link:</span>
              <code className="font-mono text-secondary truncate">{window.location.origin}/live/{activeTournament.public_slug}</code>
            </div>
          </div>
        )}

        {activeTournament.champion && (
          <div className="container mb-4">
            <div className="bg-card border-2 border-accent rounded-xl p-4 text-center glow-gold">
              <Trophy className="w-8 h-8 text-accent mx-auto mb-1" />
              <p className="font-display uppercase text-xl">{activeTournament.champion}</p>
              <p className="text-accent text-sm font-display uppercase">Champion!</p>
              <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => setCeremonyChampion(activeTournament.champion)}>
                🏆 Pokal-Zeremonie zeigen
              </Button>
            </div>
          </div>
        )}

        <BracketViewport
          matches={matches}
          totalRounds={totalRounds}
          activeTournament={activeTournament}
          roundLabel={roundLabel}
          setKoWinner={setKoWinner}
          setKoScore={setKoScore}
          resetKoMatch={resetKoMatch}
        />

        {/* Live-Ticker */}
        {(() => {
          const done = (matches as Match[]).filter(m => m.winner && m.player1 && m.player2 && m.player1 !== "BYE" && m.player2 !== "BYE").slice(-10).reverse();
          if (done.length === 0) return null;
          return (
            <div className="container mb-6">
              <div className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-accent" />
                  <h3 className="font-display uppercase text-sm">Live-Ticker · Turnierverlauf</h3>
                </div>
                <ol className="grid md:grid-cols-2 gap-2 text-xs">
                  {done.map(m => (
                    <li key={m.id} className="border-l-2 border-primary/40 pl-2">
                      <p className="font-display text-sm">
                        <span className="text-secondary">{m.winner}</span>
                        <span className="text-muted-foreground"> schlägt </span>
                        {m.winner === m.player1 ? m.player2 : m.player1}
                      </p>
                      <p className="text-muted-foreground">{roundLabel(m.round, totalRounds)} · {m.score1 ?? 0}:{m.score2 ?? 0}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          );
        })()}

        {ceremonyChampion && (
          <TrophyCeremony champion={ceremonyChampion} tournamentName={activeTournament.name} onClose={() => setCeremonyChampion(null)} />
        )}
      </div>
    );
  }

  // ─── ROUND ROBIN ────────────────────────────────
  const rrMatches = activeTournament.bracket as RoundRobinMatch[];
  const standings = calcStandings(rrMatches);
  const unplayed = rrMatches.filter(m => !m.played);
  const played = rrMatches.filter(m => m.played);

  return (
    <div className="container py-4 animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-display uppercase">{activeTournament.name}</h2>
          <p className="text-xs text-muted-foreground">Round Robin · {activeTournament.players.length} Spieler</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { setActiveTournament(null); setPhase("list"); }}>
          ← Übersicht
        </Button>
      </div>

      {activeTournament.champion && (
        <div className="bg-card border-2 border-accent rounded-xl p-4 text-center glow-gold mb-4">
          <Trophy className="w-8 h-8 text-accent mx-auto mb-1" />
          <p className="font-display uppercase text-xl">{activeTournament.champion}</p>
          <p className="text-accent text-sm font-display uppercase">Champion!</p>
          <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => setCeremonyChampion(activeTournament.champion)}>
            🏆 Pokal-Zeremonie zeigen
          </Button>
        </div>
      )}

      {/* Standings table */}
      <div className="bg-card rounded-xl border border-border p-4 mb-4">
        <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Tabelle</h3>
        <div className="grid grid-cols-[auto_1fr_repeat(4,40px)] gap-x-2 gap-y-1 text-xs">
          <span className="text-muted-foreground">#</span>
          <span className="text-muted-foreground">Spieler</span>
          <span className="text-muted-foreground text-center">Sp</span>
          <span className="text-muted-foreground text-center">S</span>
          <span className="text-muted-foreground text-center">N</span>
          <span className="text-muted-foreground text-center">Pkt</span>
          {standings.map((s, i) => (
            <>
              <span key={`pos-${s.name}`} className={`font-display ${i === 0 ? "text-accent" : ""}`}>
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
              </span>
              <span key={`name-${s.name}`} className="font-semibold truncate">{s.name}</span>
              <span key={`p-${s.name}`} className="text-center">{s.played}</span>
              <span key={`w-${s.name}`} className="text-center text-secondary">{s.won}</span>
              <span key={`l-${s.name}`} className="text-center text-destructive">{s.lost}</span>
              <span key={`pts-${s.name}`} className="text-center font-display text-primary">{s.points}</span>
            </>
          ))}
        </div>
      </div>

      {/* Upcoming matches */}
      {unplayed.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4 mb-4">
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Ausstehende Spiele ({unplayed.length})</h3>
          <div className="space-y-2">
            {unplayed.map(m => (
              <div key={m.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                <span className="text-sm">{m.player1} <span className="text-muted-foreground">vs</span> {m.player2}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => setRrWinner(m.id, m.player1)}>
                    {m.player1} ✓
                  </Button>
                  <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => setRrWinner(m.id, m.player2)}>
                    {m.player2} ✓
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Played matches */}
      {played.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-display text-sm uppercase text-muted-foreground mb-3">Gespielte Partien ({played.length})</h3>
          <div className="space-y-1">
            {played.map(m => (
              <div key={m.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                <span>{m.player1} vs {m.player2}</span>
                <span className="text-xs text-secondary font-medium">{m.winner} ✓</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {ceremonyChampion && (
        <TrophyCeremony champion={ceremonyChampion} tournamentName={activeTournament.name} onClose={() => setCeremonyChampion(null)} />
      )}
    </div>
  );
};

export default TournamentPage;
