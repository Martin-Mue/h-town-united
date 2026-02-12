import { useState } from "react";
import { Target, RotateCcw, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type GameMode = "501" | "301" | "cricket";

interface GameState {
  mode: GameMode;
  player1: { name: string; score: number; throws: number[]; sets: number };
  player2: { name: string; score: number; throws: number[]; sets: number };
  currentPlayer: 1 | 2;
  isFinished: boolean;
  winner?: string;
}

const SCORE_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25, 50];
const MULTIPLIERS = [
  { label: "Single", value: 1 },
  { label: "Double", value: 2 },
  { label: "Triple", value: 3 },
];

const GamePage = () => {
  const [phase, setPhase] = useState<"setup" | "playing">("setup");
  const [mode, setMode] = useState<GameMode>("501");
  const [p1Name, setP1Name] = useState("Spieler 1");
  const [p2Name, setP2Name] = useState("Spieler 2");
  const [game, setGame] = useState<GameState | null>(null);
  const [selectedScore, setSelectedScore] = useState<number>(20);
  const [multiplier, setMultiplier] = useState<number>(1);

  const startGame = () => {
    const startScore = mode === "cricket" ? 0 : parseInt(mode);
    setGame({
      mode,
      player1: { name: p1Name, score: startScore, throws: [], sets: 0 },
      player2: { name: p2Name, score: startScore, throws: [], sets: 0 },
      currentPlayer: 1,
      isFinished: false,
    });
    setPhase("playing");
  };

  const throwDart = () => {
    if (!game || game.isFinished) return;
    const points = selectedScore === 25 && multiplier === 3 ? 0 : selectedScore * multiplier;
    
    setGame((prev) => {
      if (!prev) return prev;
      const cp = prev.currentPlayer === 1 ? "player1" : "player2";
      const newScore = prev[cp].score - points;

      if (newScore < 0 || (newScore === 1)) {
        // Bust - switch player
        return { ...prev, currentPlayer: prev.currentPlayer === 1 ? 2 : 1 };
      }

      const updated = {
        ...prev,
        [cp]: {
          ...prev[cp],
          score: newScore,
          throws: [...prev[cp].throws, points],
        },
        currentPlayer: (newScore === 0 ? prev.currentPlayer : (prev.currentPlayer === 1 ? 2 : 1)) as 1 | 2,
      };

      if (newScore === 0) {
        updated.isFinished = true;
        updated.winner = prev[cp].name;
      }

      return updated;
    });
  };

  const resetGame = () => {
    setPhase("setup");
    setGame(null);
  };

  if (phase === "setup") {
    return (
      <div className="container py-6 animate-slide-up max-w-lg mx-auto">
        <h2 className="text-2xl font-display uppercase mb-6 text-center">Neues Spiel</h2>
        
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Spielmodus</label>
            <Select value={mode} onValueChange={(v) => setMode(v as GameMode)}>
              <SelectTrigger className="bg-card border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="501">501</SelectItem>
                <SelectItem value="301">301</SelectItem>
                <SelectItem value="cricket">Cricket (Coming Soon)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Spieler 1</label>
              <input
                value={p1Name}
                onChange={(e) => setP1Name(e.target.value)}
                className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Spieler 2</label>
              <input
                value={p2Name}
                onChange={(e) => setP2Name(e.target.value)}
                className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground"
              />
            </div>
          </div>

          <Button onClick={startGame} className="w-full mt-4 font-display uppercase text-lg py-6" disabled={mode === "cricket"}>
            <Target className="w-5 h-5 mr-2" /> Spiel starten
          </Button>
        </div>
      </div>
    );
  }

  if (!game) return null;

  const currentPlayerData = game.currentPlayer === 1 ? game.player1 : game.player2;

  return (
    <div className="container py-4 animate-slide-up max-w-lg mx-auto">
      {/* Winner overlay */}
      {game.isFinished && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-card border border-border rounded-2xl p-8 text-center animate-slide-up max-w-sm mx-4">
            <Trophy className="w-16 h-16 text-accent mx-auto mb-4" />
            <h2 className="text-3xl font-display uppercase mb-2">{game.winner}</h2>
            <p className="text-accent font-display text-xl uppercase mb-6">Gewinnt!</p>
            <Button onClick={resetGame} className="w-full font-display uppercase">
              Neues Spiel
            </Button>
          </div>
        </div>
      )}

      {/* Scoreboard */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[game.player1, game.player2].map((p, i) => (
          <div
            key={i}
            className={`bg-card rounded-xl p-4 border-2 transition-colors text-center ${
              game.currentPlayer === i + 1 ? "border-primary glow-red" : "border-border"
            }`}
          >
            <p className="text-sm text-muted-foreground truncate">{p.name}</p>
            <p className="text-4xl font-display mt-1">{p.score}</p>
            <p className="text-xs text-muted-foreground mt-1">{p.throws.length} Würfe</p>
          </div>
        ))}
      </div>

      {/* Current player indicator */}
      <div className="text-center mb-4">
        <span className="text-sm text-primary font-medium">
          {currentPlayerData.name} wirft
        </span>
      </div>

      {/* Score input */}
      <div className="bg-card rounded-xl border border-border p-4 mb-4">
        <div className="flex gap-2 mb-3 justify-center">
          {MULTIPLIERS.map((m) => (
            <button
              key={m.value}
              onClick={() => setMultiplier(m.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                multiplier === m.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5 mb-3">
          {SCORE_VALUES.filter(v => v <= 20 && v > 0).map((v) => (
            <button
              key={v}
              onClick={() => setSelectedScore(v)}
              className={`aspect-square rounded-lg text-sm font-bold transition-all ${
                selectedScore === v
                  ? "bg-primary text-primary-foreground scale-110"
                  : "bg-muted text-foreground hover:bg-muted/80"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-3 justify-center">
          {[0, 25, 50].map((v) => (
            <button
              key={v}
              onClick={() => { setSelectedScore(v); if (v === 50 || v === 25) setMultiplier(1); }}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                selectedScore === v
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted text-foreground hover:bg-muted/80"
              }`}
            >
              {v === 0 ? "Miss" : v === 25 ? "Bull" : "Bullseye"}
            </button>
          ))}
        </div>

        <div className="text-center mb-3">
          <span className="text-2xl font-display text-accent">
            {selectedScore === 0 ? 0 : selectedScore * multiplier}
          </span>
          <span className="text-sm text-muted-foreground ml-2">Punkte</span>
        </div>

        <Button onClick={throwDart} className="w-full font-display uppercase" disabled={game.isFinished}>
          Wurf eintragen
        </Button>
      </div>

      <Button variant="ghost" onClick={resetGame} className="w-full text-muted-foreground">
        <RotateCcw className="w-4 h-4 mr-2" /> Spiel abbrechen
      </Button>
    </div>
  );
};

export default GamePage;
