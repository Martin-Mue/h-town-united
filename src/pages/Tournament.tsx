import { useState, useEffect, useCallback } from "react";
import { Trophy, Plus, Play, RotateCcw, Trash2, Loader2, Users, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Match {
  id: string;
  round: number;
  position: number;
  player1?: string;
  player2?: string;
  winner?: string;
  score1?: number;
  score2?: number;
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
}

const TournamentPage = () => {
  const [phase, setPhase] = useState<"list" | "setup" | "bracket">("list");
  const [tournaments, setTournaments] = useState<TournamentRecord[]>([]);
  const [activeTournament, setActiveTournament] = useState<TournamentRecord | null>(null);
  const [loading, setLoading] = useState(true);

  // Setup state
  const [tournamentName, setTournamentName] = useState("");
  const [tournamentMode, setTournamentMode] = useState("ko");
  const [playerInput, setPlayerInput] = useState("");
  const [players, setPlayers] = useState<string[]>([]);
  const [dbPlayers, setDbPlayers] = useState<{ id: string; name: string; emoji: string }[]>([]);

  const { session } = useAuth();
  const { toast } = useToast();

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
      })) as TournamentRecord[]);
    }
    setLoading(false);
  }, []);

  const fetchDbPlayers = useCallback(async () => {
    const { data } = await supabase.from("players").select("id, name, emoji").order("name");
    if (data) setDbPlayers(data);
  }, []);

  useEffect(() => { fetchTournaments(); fetchDbPlayers(); }, [fetchTournaments, fetchDbPlayers]);

  const addPlayer = () => {
    const name = playerInput.trim();
    if (name && !players.includes(name)) {
      setPlayers([...players, name]);
      setPlayerInput("");
    }
  };

  const addDbPlayer = (name: string) => {
    if (!players.includes(name)) setPlayers([...players, name]);
  };

  const removePlayer = (name: string) => setPlayers(players.filter(p => p !== name));

  // ─── KO Bracket Generation ──────────────────────
  const generateKoBracket = (playerList: string[]): Match[] => {
    const size = Math.pow(2, Math.ceil(Math.log2(playerList.length)));
    const padded = [...playerList];
    while (padded.length < size) padded.push("BYE");
    const shuffled = padded.sort(() => Math.random() - 0.5);

    const firstRound: Match[] = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      firstRound.push({
        id: `r1-${i / 2}`,
        round: 1,
        position: i / 2,
        player1: shuffled[i],
        player2: shuffled[i + 1],
        winner: shuffled[i + 1] === "BYE" ? shuffled[i] : shuffled[i] === "BYE" ? shuffled[i + 1] : undefined,
      });
    }

    const totalRounds = Math.log2(size);
    const allMatches = [...firstRound];
    for (let round = 2; round <= totalRounds; round++) {
      const count = size / Math.pow(2, round);
      for (let pos = 0; pos < count; pos++) {
        allMatches.push({ id: `r${round}-${pos}`, round, position: pos });
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
    return matches.sort(() => Math.random() - 0.5);
  };

  // ─── Start Tournament ──────────────────────────
  const startTournament = async () => {
    if (players.length < 2) return;
    const bracket = tournamentMode === "ko" ? generateKoBracket(players) : generateRoundRobin(players);

    const { data, error } = await supabase.from("tournaments").insert({
      name: tournamentName || "Turnier",
      mode: tournamentMode,
      user_id: session?.user?.id,
      players: players as any,
      bracket: bracket as any,
      status: "active",
    }).select().single();

    if (error || !data) {
      toast({ title: "Fehler", description: "Turnier konnte nicht erstellt werden.", variant: "destructive" });
      return;
    }

    const record: TournamentRecord = { ...data, players: data.players as any, bracket: data.bracket as any };
    setActiveTournament(record);
    setPhase("bracket");
    setPlayers([]);
    setTournamentName("");
    fetchTournaments();
  };

  // ─── KO: Set Winner ────────────────────────────
  const setKoWinner = async (matchId: string, winner: string) => {
    if (!activeTournament) return;
    const bracket = [...(activeTournament.bracket as Match[])];
    const updated = bracket.map(m => m.id === matchId ? { ...m, winner } : m);

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
          <Button size="sm" onClick={() => setPhase("setup")} className="gap-1">
            <Plus className="w-4 h-4" /> Neues Turnier
          </Button>
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
      <div className="container py-6 animate-slide-up max-w-lg mx-auto">
        <Button variant="ghost" onClick={() => setPhase("list")} className="mb-4 text-muted-foreground text-sm">← Zurück</Button>
        <h2 className="text-2xl font-display uppercase mb-6 text-center">Turnier erstellen</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Turniername</label>
            <Input value={tournamentName} onChange={(e) => setTournamentName(e.target.value)} placeholder="z.B. Vereinsmeisterschaft 2026" className="bg-card border-border" />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Modus</label>
            <Select value={tournamentMode} onValueChange={setTournamentMode}>
              <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="ko">K.O.-System</SelectItem>
                <SelectItem value="round-robin">Jeder gegen Jeden</SelectItem>
              </SelectContent>
            </Select>
          </div>

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
  const isKo = activeTournament.mode === "ko";

  if (isKo) {
    const matches = activeTournament.bracket as Match[];
    const totalRounds = matches.length > 0 ? Math.max(...matches.map(m => m.round)) : 0;

    return (
      <div className="py-4 animate-slide-up">
        <div className="container flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-display uppercase">{activeTournament.name}</h2>
            <p className="text-xs text-muted-foreground">K.O.-System · {activeTournament.players.length} Spieler</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setActiveTournament(null); setPhase("list"); }}>
            ← Übersicht
          </Button>
        </div>

        {activeTournament.champion && (
          <div className="container mb-4">
            <div className="bg-card border-2 border-accent rounded-xl p-4 text-center glow-gold">
              <Trophy className="w-8 h-8 text-accent mx-auto mb-1" />
              <p className="font-display uppercase text-xl">{activeTournament.champion}</p>
              <p className="text-accent text-sm font-display uppercase">Champion!</p>
            </div>
          </div>
        )}

        <div className="overflow-x-auto pb-4">
          <div className="flex gap-6 min-w-max px-4">
            {Array.from({ length: totalRounds }, (_, r) => r + 1).map(round => {
              const roundMatches = matches.filter(m => m.round === round);
              return (
                <div key={round} className="flex flex-col gap-4 min-w-[200px]">
                  <h3 className="text-xs font-display uppercase text-muted-foreground text-center mb-1">
                    {roundLabel(round, totalRounds)}
                  </h3>
                  <div className="flex flex-col justify-around flex-1 gap-4">
                    {roundMatches.map(match => (
                      <div key={match.id} className={`bg-card border rounded-xl overflow-hidden ${match.winner ? "border-border" : "border-primary/30"}`}>
                        {[match.player1, match.player2].map((player, idx) => (
                          <button key={idx} disabled={!player || player === "BYE" || !!match.winner}
                            onClick={() => player && setKoWinner(match.id, player)}
                            className={`w-full px-3 py-2.5 text-sm text-left flex items-center justify-between transition-colors ${
                              idx === 0 ? "border-b border-border" : ""
                            } ${match.winner === player ? "bg-secondary/10 text-secondary font-semibold" : player === "BYE" ? "text-muted-foreground/30" : "hover:bg-muted"} ${!player ? "text-muted-foreground/30" : ""}`}>
                            <span>{player || "TBD"}</span>
                            {match.winner === player && <Trophy className="w-3 h-3 text-secondary" />}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
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
    </div>
  );
};

export default TournamentPage;
