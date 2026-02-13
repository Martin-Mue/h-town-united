import { useState, useMemo } from "react";
import { RotateCcw, Trophy, Target, Edit2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DartScoreInput from "@/components/game/DartScoreInput";
import CheckoutSuggestion from "@/components/game/CheckoutSuggestion";
import type { GameMode, GameState, LegState, DartThrow, CricketPlayerState } from "@/types/game";
import { CRICKET_NUMBERS } from "@/types/game";

/** Creates a fresh leg state */
function createLegState(legNumber: number, startScore: number, startingPlayer: 1 | 2): LegState {
  return {
    legNumber,
    startingPlayerId: startingPlayer,
    player1Remaining: startScore,
    player2Remaining: startScore,
    player1Throws: [],
    player2Throws: [],
  };
}

/** Creates fresh cricket state */
function createCricketState(): CricketPlayerState {
  const marks: Record<number, number> = {};
  CRICKET_NUMBERS.forEach((n) => (marks[n] = 0));
  return { marks, points: 0 };
}

/** Calculates 3-dart average from throws */
function calculateAverage(throws: DartThrow[]): number {
  if (throws.length === 0) return 0;
  const totalPoints = throws.reduce((sum, t) => sum + t.points, 0);
  return (totalPoints / throws.length) * 3;
}

/** Finds the highest single-throw score */
function getHighestThrow(throws: DartThrow[]): number {
  return throws.reduce((max, t) => Math.max(max, t.points), 0);
}

/**
 * Main game page handling setup, playing, and post-game phases.
 * Supports 501, 301, Cricket, and custom game modes with multi-leg matches.
 */
const GamePage = () => {
  const [phase, setPhase] = useState<"setup" | "playing" | "postGame">("setup");
  const [mode, setMode] = useState<GameMode>("501");
  const [bestOfLegs, setBestOfLegs] = useState(1);
  const [customStartScore, setCustomStartScore] = useState(501);
  const [p1Name, setP1Name] = useState("Spieler 1");
  const [p2Name, setP2Name] = useState("Spieler 2");
  const [game, setGame] = useState<GameState | null>(null);
  const [selectedScore, setSelectedScore] = useState(20);
  const [multiplier, setMultiplier] = useState(1);
  const [editingThrowIdx, setEditingThrowIdx] = useState<number | null>(null);
  const [legWinnerBanner, setLegWinnerBanner] = useState<string | null>(null);

  /** Determines starting score based on mode */
  const getStartScore = (): number => {
    if (mode === "cricket") return 0;
    if (mode === "custom") return customStartScore;
    return parseInt(mode);
  };

  /** Starts a new game with current settings */
  const startGame = () => {
    const startScore = getStartScore();
    const newGame: GameState = {
      mode,
      startScore,
      bestOfLegs,
      player1Name: p1Name,
      player2Name: p2Name,
      player1LegsWon: 0,
      player2LegsWon: 0,
      currentLeg: createLegState(1, startScore, 1),
      completedLegs: [],
      currentPlayerId: 1,
      isFinished: false,
    };
    if (mode === "cricket") {
      newGame.player1Cricket = createCricketState();
      newGame.player2Cricket = createCricketState();
    }
    setGame(newGame);
    setPhase("playing");
  };

  /** Processes a standard (x01) dart throw */
  const handleX01Throw = () => {
    if (!game || game.isFinished) return;
    const points = selectedScore === 25 && multiplier === 3 ? 0 : selectedScore * multiplier;
    const dart: DartThrow = { baseValue: selectedScore, multiplier, points };

    setGame((prev) => {
      if (!prev) return prev;
      const isP1 = prev.currentPlayerId === 1;
      const remaining = isP1 ? prev.currentLeg.player1Remaining : prev.currentLeg.player2Remaining;
      const newRemaining = remaining - points;

      // Bust: score goes below 0 or equals 1
      if (newRemaining < 0 || newRemaining === 1) {
        return { ...prev, currentPlayerId: isP1 ? 2 : 1 };
      }

      const updatedLeg = { ...prev.currentLeg };
      if (isP1) {
        updatedLeg.player1Remaining = newRemaining;
        updatedLeg.player1Throws = [...updatedLeg.player1Throws, dart];
      } else {
        updatedLeg.player2Remaining = newRemaining;
        updatedLeg.player2Throws = [...updatedLeg.player2Throws, dart];
      }

      const updated: GameState = {
        ...prev,
        currentLeg: updatedLeg,
        currentPlayerId: newRemaining === 0 ? prev.currentPlayerId : (isP1 ? 2 : 1),
      };

      // Leg won
      if (newRemaining === 0) {
        updatedLeg.winner = isP1 ? 1 : 2;
        const p1Legs = prev.player1LegsWon + (isP1 ? 1 : 0);
        const p2Legs = prev.player2LegsWon + (isP1 ? 0 : 1);
        updated.player1LegsWon = p1Legs;
        updated.player2LegsWon = p2Legs;

        const legsToWin = Math.ceil(prev.bestOfLegs / 2);
        if (p1Legs >= legsToWin || p2Legs >= legsToWin) {
          updated.isFinished = true;
          updated.winnerName = isP1 ? prev.player1Name : prev.player2Name;
        } else {
          // Start next leg (loser starts)
          updated.completedLegs = [...prev.completedLegs, updatedLeg];
          updated.currentLeg = createLegState(
            updatedLeg.legNumber + 1,
            prev.startScore,
            isP1 ? 2 : 1
          );
          updated.currentPlayerId = isP1 ? 2 : 1;
        }
      }

      return updated;
    });
  };

  /** Processes a cricket dart throw */
  const handleCricketThrow = () => {
    if (!game || game.isFinished) return;
    const points = selectedScore === 25 && multiplier === 3 ? 0 : selectedScore * multiplier;
    const dart: DartThrow = { baseValue: selectedScore, multiplier, points };
    const targetNumber = selectedScore === 50 ? 25 : selectedScore;

    setGame((prev) => {
      if (!prev) return prev;
      const isP1 = prev.currentPlayerId === 1;
      const myState = isP1 ? { ...prev.player1Cricket! } : { ...prev.player2Cricket! };
      const oppState = isP1 ? prev.player2Cricket! : prev.player1Cricket!;

      // Only cricket numbers count
      if (CRICKET_NUMBERS.includes(targetNumber as any) && targetNumber !== 0) {
        const hitsToAdd = selectedScore === 50 ? 2 : multiplier;
        const currentMarks = myState.marks[targetNumber] || 0;
        const newMarks = currentMarks + hitsToAdd;
        myState.marks = { ...myState.marks, [targetNumber]: newMarks };

        // Score points if I have 3+ and opponent hasn't closed
        if (newMarks > 3 && (oppState.marks[targetNumber] || 0) < 3) {
          const scorableHits = newMarks - Math.max(currentMarks, 3);
          myState.points += targetNumber * scorableHits;
        }
      }

      const updatedLeg = { ...prev.currentLeg };
      if (isP1) {
        updatedLeg.player1Throws = [...updatedLeg.player1Throws, dart];
      } else {
        updatedLeg.player2Throws = [...updatedLeg.player2Throws, dart];
      }

      const updated: GameState = {
        ...prev,
        currentLeg: updatedLeg,
        player1Cricket: isP1 ? myState : prev.player1Cricket,
        player2Cricket: isP1 ? prev.player2Cricket : myState,
        currentPlayerId: isP1 ? 2 : 1,
      };

      // Check cricket win: all numbers closed and points >= opponent
      const allClosed = CRICKET_NUMBERS.every((n) => (myState.marks[n] || 0) >= 3);
      if (allClosed && myState.points >= oppState.points) {
        updatedLeg.winner = isP1 ? 1 : 2;
        updated.isFinished = true;
        updated.winnerName = isP1 ? prev.player1Name : prev.player2Name;
      }

      return updated;
    });
  };

  /** Routes throw to correct handler based on mode */
  const throwDart = () => {
    if (game?.mode === "cricket") handleCricketThrow();
    else handleX01Throw();
  };

  /** Deletes a throw and recalculates remaining score */
  const deleteThrow = (playerNum: 1 | 2, throwIndex: number) => {
    setGame((prev) => {
      if (!prev) return prev;
      const isP1 = playerNum === 1;
      const throws = isP1 ? [...prev.currentLeg.player1Throws] : [...prev.currentLeg.player2Throws];
      const removed = throws.splice(throwIndex, 1)[0];
      const updatedLeg = { ...prev.currentLeg };

      if (isP1) {
        updatedLeg.player1Throws = throws;
        updatedLeg.player1Remaining += removed.points;
      } else {
        updatedLeg.player2Throws = throws;
        updatedLeg.player2Remaining += removed.points;
      }

      return { ...prev, currentLeg: updatedLeg };
    });
    setEditingThrowIdx(null);
  };

  /** Resets the game to setup */
  const resetGame = () => {
    setPhase("setup");
    setGame(null);
    setLegWinnerBanner(null);
  };

  /** Post-game statistics derived from completed game */
  const postGameStats = useMemo(() => {
    if (!game || !game.isFinished) return null;
    const allLegs = [...game.completedLegs, game.currentLeg];
    const p1Throws = allLegs.flatMap((l) => l.player1Throws);
    const p2Throws = allLegs.flatMap((l) => l.player2Throws);
    return {
      player1Average: calculateAverage(p1Throws),
      player2Average: calculateAverage(p2Throws),
      player1Highscore: getHighestThrow(p1Throws),
      player2Highscore: getHighestThrow(p2Throws),
      p1TotalThrows: p1Throws.length,
      p2TotalThrows: p2Throws.length,
    };
  }, [game?.isFinished]);

  // ─── SETUP PHASE ───────────────────────────────────
  if (phase === "setup") {
    return (
      <div className="container py-6 animate-slide-up max-w-lg mx-auto">
        <h2 className="text-2xl font-display uppercase mb-6 text-center">Neues Spiel</h2>
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Spielmodus</label>
            <Select value={mode} onValueChange={(v) => setMode(v as GameMode)}>
              <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="501">501</SelectItem>
                <SelectItem value="301">301</SelectItem>
                <SelectItem value="cricket">Cricket</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "custom" && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Startwert</label>
              <input
                type="number"
                value={customStartScore}
                onChange={(e) => setCustomStartScore(parseInt(e.target.value) || 0)}
                className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground"
              />
            </div>
          )}

          {mode !== "cricket" && (
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Best of (Legs)</label>
              <Select value={String(bestOfLegs)} onValueChange={(v) => setBestOfLegs(parseInt(v))}>
                <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {[1, 3, 5, 7, 9, 11].map((n) => (
                    <SelectItem key={n} value={String(n)}>Best of {n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Spieler 1</label>
              <input value={p1Name} onChange={(e) => setP1Name(e.target.value)}
                className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Spieler 2</label>
              <input value={p2Name} onChange={(e) => setP2Name(e.target.value)}
                className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground" />
            </div>
          </div>

          <Button onClick={startGame} className="w-full mt-4 font-display uppercase text-lg py-6">
            <Target className="w-5 h-5 mr-2" /> Spiel starten
          </Button>
        </div>
      </div>
    );
  }

  if (!game) return null;

  const isP1Turn = game.currentPlayerId === 1;
  const currentPlayerName = isP1Turn ? game.player1Name : game.player2Name;
  const currentRemaining = isP1Turn ? game.currentLeg.player1Remaining : game.currentLeg.player2Remaining;
  const currentThrows = isP1Turn ? game.currentLeg.player1Throws : game.currentLeg.player2Throws;
  const isCricket = game.mode === "cricket";

  // ─── PLAYING PHASE ─────────────────────────────────
  return (
    <div className="container py-4 animate-slide-up max-w-lg mx-auto">
      {/* Winner overlay */}
      {game.isFinished && (
        <div className="fixed inset-0 bg-background/85 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-card border border-primary/30 rounded-2xl p-8 text-center animate-scale-in max-w-sm mx-4 glow-cyan">
            <Trophy className="w-16 h-16 text-accent mx-auto mb-4" />
            <h2 className="text-3xl font-display uppercase mb-1">{game.winnerName}</h2>
            <p className="text-accent font-display text-xl uppercase mb-4">Gewinnt!</p>

            {/* Post-game stats */}
            {postGameStats && (
              <div className="grid grid-cols-2 gap-3 mb-6 text-left">
                {[
                  { label: game.player1Name, avg: postGameStats.player1Average, high: postGameStats.player1Highscore, throws: postGameStats.p1TotalThrows, legs: game.player1LegsWon },
                  { label: game.player2Name, avg: postGameStats.player2Average, high: postGameStats.player2Highscore, throws: postGameStats.p2TotalThrows, legs: game.player2LegsWon },
                ].map((p) => (
                  <div key={p.label} className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
                    <p className="font-semibold text-sm truncate">{p.label}</p>
                    <p className="text-muted-foreground">Ø <span className="text-foreground font-bold">{p.avg.toFixed(1)}</span></p>
                    <p className="text-muted-foreground">High <span className="text-foreground font-bold">{p.high}</span></p>
                    <p className="text-muted-foreground">Würfe <span className="text-foreground font-bold">{p.throws}</span></p>
                    {game.bestOfLegs > 1 && (
                      <p className="text-muted-foreground">Legs <span className="text-foreground font-bold">{p.legs}</span></p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Button onClick={resetGame} className="w-full font-display uppercase">Neues Spiel</Button>
          </div>
        </div>
      )}

      {/* Scoreboard */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {[
          { name: game.player1Name, remaining: game.currentLeg.player1Remaining, throws: game.currentLeg.player1Throws, legs: game.player1LegsWon, playerId: 1 as const, cricket: game.player1Cricket },
          { name: game.player2Name, remaining: game.currentLeg.player2Remaining, throws: game.currentLeg.player2Throws, legs: game.player2LegsWon, playerId: 2 as const, cricket: game.player2Cricket },
        ].map((p) => (
          <div
            key={p.playerId}
            className={`bg-card rounded-xl p-4 border-2 transition-all text-center ${
              game.currentPlayerId === p.playerId ? "border-primary glow-cyan" : "border-border"
            }`}
          >
            <p className="text-sm text-muted-foreground truncate">{p.name}</p>
            <p className="text-4xl font-display mt-1">
              {isCricket ? p.cricket?.points ?? 0 : p.remaining}
            </p>
            <div className="flex justify-center gap-3 mt-1 text-xs text-muted-foreground">
              <span>Ø {calculateAverage(p.throws).toFixed(1)}</span>
              {game.bestOfLegs > 1 && <span className="text-primary font-bold">{p.legs} Legs</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Leg info bar */}
      {game.bestOfLegs > 1 && (
        <div className="text-center text-xs text-muted-foreground mb-2">
          Leg {game.currentLeg.legNumber} · Angefangen: {game.currentLeg.startingPlayerId === 1 ? game.player1Name : game.player2Name}
        </div>
      )}

      {/* Current player indicator */}
      <div className="text-center mb-3">
        <span className="text-sm text-primary font-medium">{currentPlayerName} wirft</span>
      </div>

      {/* Checkout suggestion (x01 modes only) */}
      {!isCricket && <div className="mb-3"><CheckoutSuggestion remaining={currentRemaining} playerName={currentPlayerName} /></div>}

      {/* Cricket scoreboard */}
      {isCricket && game.player1Cricket && game.player2Cricket && (
        <div className="bg-card rounded-xl border border-border p-3 mb-3">
          <div className="grid grid-cols-3 gap-1 text-center text-xs">
            <span className="font-bold truncate">{game.player1Name}</span>
            <span className="text-muted-foreground">Ziel</span>
            <span className="font-bold truncate">{game.player2Name}</span>
            {CRICKET_NUMBERS.map((num) => {
              const p1m = game.player1Cricket!.marks[num] || 0;
              const p2m = game.player2Cricket!.marks[num] || 0;
              const renderMarks = (m: number) => m >= 3 ? "✕" : m === 2 ? "╳" : m === 1 ? "/" : "·";
              return [
                <span key={`p1-${num}`} className={p1m >= 3 ? "text-secondary font-bold" : "text-muted-foreground"}>{renderMarks(p1m)}</span>,
                <span key={`n-${num}`} className="font-display">{num === 25 ? "Bull" : num}</span>,
                <span key={`p2-${num}`} className={p2m >= 3 ? "text-secondary font-bold" : "text-muted-foreground"}>{renderMarks(p2m)}</span>,
              ];
            })}
          </div>
        </div>
      )}

      {/* Score input */}
      <DartScoreInput
        selectedValue={selectedScore}
        selectedMultiplier={multiplier}
        isDisabled={game.isFinished}
        onValueSelect={setSelectedScore}
        onMultiplierSelect={setMultiplier}
        onSubmit={throwDart}
      />

      {/* Throw history (editable) */}
      {currentThrows.length > 0 && (
        <div className="mt-3 bg-card rounded-xl border border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground uppercase font-display">Letzte Würfe · {currentPlayerName}</p>
            <button
              onClick={() => setEditingThrowIdx(editingThrowIdx !== null ? null : 0)}
              className="text-xs text-primary flex items-center gap-1"
            >
              <Edit2 className="w-3 h-3" /> Bearbeiten
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {currentThrows.map((t, i) => (
              <div key={i} className="relative group">
                <span className={`inline-block px-2 py-1 rounded text-xs font-mono ${
                  t.multiplier === 3 ? "bg-destructive/20 text-destructive" :
                  t.multiplier === 2 ? "bg-secondary/20 text-secondary" :
                  "bg-muted text-foreground"
                }`}>
                  {t.multiplier === 3 ? "T" : t.multiplier === 2 ? "D" : ""}{t.baseValue === 50 ? "Bull" : t.baseValue}
                </span>
                {editingThrowIdx !== null && (
                  <button
                    onClick={() => deleteThrow(game.currentPlayerId, i)}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-destructive rounded-full flex items-center justify-center"
                  >
                    <X className="w-2.5 h-2.5 text-destructive-foreground" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Button variant="ghost" onClick={resetGame} className="w-full mt-3 text-muted-foreground">
        <RotateCcw className="w-4 h-4 mr-2" /> Spiel abbrechen
      </Button>
    </div>
  );
};

export default GamePage;
