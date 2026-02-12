import { useState } from "react";
import { Trophy, Plus, Play, RotateCcw, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TournamentPlayer {
  name: string;
  seed: number;
}

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

const TournamentPage = () => {
  const [phase, setPhase] = useState<"setup" | "bracket">("setup");
  const [tournamentName, setTournamentName] = useState("");
  const [tournamentMode, setTournamentMode] = useState("ko");
  const [playerInput, setPlayerInput] = useState("");
  const [players, setPlayers] = useState<string[]>([
    "Max", "Anna", "Tom", "Lisa", "Jan", "Maria", "Paul", "Eva",
  ]);
  const [matches, setMatches] = useState<Match[]>([]);

  const addPlayer = () => {
    if (playerInput.trim() && !players.includes(playerInput.trim())) {
      setPlayers([...players, playerInput.trim()]);
      setPlayerInput("");
    }
  };

  const removePlayer = (name: string) => {
    setPlayers(players.filter((p) => p !== name));
  };

  const generateBracket = () => {
    // Ensure power of 2 players
    const size = Math.pow(2, Math.ceil(Math.log2(players.length)));
    const paddedPlayers = [...players];
    while (paddedPlayers.length < size) paddedPlayers.push("BYE");

    const shuffled = paddedPlayers.sort(() => Math.random() - 0.5);
    const firstRoundMatches: Match[] = [];

    for (let i = 0; i < shuffled.length; i += 2) {
      firstRoundMatches.push({
        id: `r1-${i / 2}`,
        round: 1,
        position: i / 2,
        player1: shuffled[i],
        player2: shuffled[i + 1],
        winner: shuffled[i + 1] === "BYE" ? shuffled[i] : shuffled[i] === "BYE" ? shuffled[i + 1] : undefined,
      });
    }

    // Generate empty matches for subsequent rounds
    const totalRounds = Math.log2(size);
    const allMatches = [...firstRoundMatches];
    for (let round = 2; round <= totalRounds; round++) {
      const matchesInRound = size / Math.pow(2, round);
      for (let pos = 0; pos < matchesInRound; pos++) {
        allMatches.push({
          id: `r${round}-${pos}`,
          round,
          position: pos,
        });
      }
    }

    // Propagate BYE wins
    propagateWinners(allMatches);
    setMatches(allMatches);
    setPhase("bracket");
  };

  const propagateWinners = (allMatches: Match[]) => {
    const totalRounds = Math.max(...allMatches.map((m) => m.round));
    for (let round = 1; round < totalRounds; round++) {
      const roundMatches = allMatches.filter((m) => m.round === round);
      const nextRoundMatches = allMatches.filter((m) => m.round === round + 1);
      roundMatches.forEach((match, idx) => {
        if (match.winner) {
          const nextMatch = nextRoundMatches[Math.floor(idx / 2)];
          if (nextMatch) {
            if (idx % 2 === 0) nextMatch.player1 = match.winner;
            else nextMatch.player2 = match.winner;
          }
        }
      });
    }
  };

  const setWinner = (matchId: string, winner: string) => {
    setMatches((prev) => {
      const updated = prev.map((m) => (m.id === matchId ? { ...m, winner } : m));
      // Propagate winner to next round
      const match = updated.find((m) => m.id === matchId)!;
      const nextRoundMatches = updated.filter((m) => m.round === match.round + 1);
      if (nextRoundMatches.length > 0) {
        const roundMatches = updated.filter((m) => m.round === match.round);
        const idx = roundMatches.indexOf(match);
        const nextMatch = nextRoundMatches[Math.floor(idx / 2)];
        if (nextMatch) {
          if (idx % 2 === 0) nextMatch.player1 = winner;
          else nextMatch.player2 = winner;
        }
      }
      return [...updated];
    });
  };

  const totalRounds = matches.length > 0 ? Math.max(...matches.map((m) => m.round)) : 0;
  const champion = matches.find((m) => m.round === totalRounds)?.winner;

  const roundLabels = (round: number, total: number) => {
    if (round === total) return "Finale";
    if (round === total - 1) return "Halbfinale";
    if (round === total - 2) return "Viertelfinale";
    return `Runde ${round}`;
  };

  if (phase === "setup") {
    return (
      <div className="container py-6 animate-slide-up max-w-lg mx-auto">
        <h2 className="text-2xl font-display uppercase mb-6 text-center">Turnier erstellen</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Turniername</label>
            <Input value={tournamentName} onChange={(e) => setTournamentName(e.target.value)} placeholder="z.B. Vereinsmeisterschaft 2026" className="bg-card border-border" />
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Modus</label>
            <Select value={tournamentMode} onValueChange={setTournamentMode}>
              <SelectTrigger className="bg-card border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="ko">K.O.-System</SelectItem>
                <SelectItem value="dko">Doppel-K.O. (bald)</SelectItem>
                <SelectItem value="round-robin">Jeder gegen Jeden (bald)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Teilnehmer ({players.length})</label>
            <div className="flex gap-2 mb-2">
              <Input value={playerInput} onChange={(e) => setPlayerInput(e.target.value)} placeholder="Name hinzufügen" className="bg-card border-border" onKeyDown={(e) => e.key === "Enter" && addPlayer()} />
              <Button onClick={addPlayer} size="icon" variant="outline">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {players.map((p) => (
                <button
                  key={p}
                  onClick={() => removePlayer(p)}
                  className="bg-card border border-border rounded-lg px-3 py-1 text-sm hover:border-destructive hover:text-destructive transition-colors group"
                >
                  {p} <span className="text-muted-foreground group-hover:text-destructive ml-1">×</span>
                </button>
              ))}
            </div>
          </div>

          <Button onClick={generateBracket} className="w-full mt-4 font-display uppercase text-lg py-6" disabled={players.length < 2 || tournamentMode !== "ko"}>
            <Play className="w-5 h-5 mr-2" /> Turnier starten
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-4 animate-slide-up">
      <div className="container flex items-center justify-between mb-4">
        <h2 className="text-xl font-display uppercase">{tournamentName || "Turnier"}</h2>
        <Button variant="ghost" size="sm" onClick={() => { setPhase("setup"); setMatches([]); }}>
          <RotateCcw className="w-4 h-4 mr-1" /> Neu
        </Button>
      </div>

      {champion && (
        <div className="container mb-4">
          <div className="bg-card border-2 border-accent rounded-xl p-4 text-center glow-gold">
            <Trophy className="w-8 h-8 text-accent mx-auto mb-1" />
            <p className="font-display uppercase text-xl">{champion}</p>
            <p className="text-accent text-sm font-display uppercase">Champion!</p>
          </div>
        </div>
      )}

      {/* Bracket - horizontal scroll on mobile */}
      <div className="overflow-x-auto pb-4">
        <div className="flex gap-6 min-w-max px-4">
          {Array.from({ length: totalRounds }, (_, r) => r + 1).map((round) => {
            const roundMatches = matches.filter((m) => m.round === round);
            return (
              <div key={round} className="flex flex-col gap-4 min-w-[200px]">
                <h3 className="text-xs font-display uppercase text-muted-foreground text-center mb-1">
                  {roundLabels(round, totalRounds)}
                </h3>
                <div className="flex flex-col justify-around flex-1 gap-4">
                  {roundMatches.map((match) => (
                    <div key={match.id} className={`bg-card border rounded-xl overflow-hidden ${match.winner ? "border-border" : "border-primary/30"}`}>
                      {[match.player1, match.player2].map((player, idx) => (
                        <button
                          key={idx}
                          disabled={!player || player === "BYE" || !!match.winner}
                          onClick={() => player && setWinner(match.id, player)}
                          className={`w-full px-3 py-2.5 text-sm text-left flex items-center justify-between transition-colors ${
                            idx === 0 ? "border-b border-border" : ""
                          } ${
                            match.winner === player
                              ? "bg-secondary/10 text-secondary font-semibold"
                              : player === "BYE"
                              ? "text-muted-foreground/30"
                              : "hover:bg-muted"
                          } ${!player ? "text-muted-foreground/30" : ""}`}
                        >
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
};

export default TournamentPage;
