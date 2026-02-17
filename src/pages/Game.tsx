import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { RotateCcw, Trophy, Target, Edit2, Check, X, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import DartScoreInput from "@/components/game/DartScoreInput";
import CheckoutSuggestion from "@/components/game/CheckoutSuggestion";
import type { GameMode, GameState, LegState, DartThrow, CricketPlayerState } from "@/types/game";
import { CRICKET_NUMBERS } from "@/types/game";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

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

interface DbPlayer {
  id: string;
  name: string;
  emoji: string;
}

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
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [gameSaved, setGameSaved] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();
  const savingRef = useRef(false);

  // Player selection from DB
  const [dbPlayers, setDbPlayers] = useState<DbPlayer[]>([]);

  useEffect(() => {
    supabase.from("players").select("id, name, emoji").order("name").then(({ data }) => {
      if (data) setDbPlayers(data);
    });
  }, []);

  // 3-dart turn tracking
  const [dartsThisRound, setDartsThisRound] = useState(0);
  const [turnStartRemaining, setTurnStartRemaining] = useState<number>(0);

  const getStartScore = (): number => {
    if (mode === "cricket") return 0;
    if (mode === "custom") return customStartScore;
    return parseInt(mode);
  };

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
    setDartsThisRound(0);
    setTurnStartRemaining(startScore);
  };

  /** Processes a standard (x01) dart throw with 3-dart turns */
  const handleX01Throw = () => {
    if (!game || game.isFinished) return;
    const points = selectedScore === 25 && multiplier === 3 ? 0 : selectedScore * multiplier;
    const dart: DartThrow = { baseValue: selectedScore, multiplier, points };
    const isP1 = game.currentPlayerId === 1;
    const remaining = isP1 ? game.currentLeg.player1Remaining : game.currentLeg.player2Remaining;
    const newRemaining = remaining - points;
    const newDartsThisRound = dartsThisRound + 1;

    // Bust: score goes below 0 or equals 1 → reset entire turn, switch player
    if (newRemaining < 0 || newRemaining === 1) {
      setGame((prev) => {
        if (!prev) return prev;
        const updatedLeg = { ...prev.currentLeg };
        // Reset remaining to turn start value
        if (isP1) {
          updatedLeg.player1Remaining = turnStartRemaining;
          // Remove darts thrown this turn
          updatedLeg.player1Throws = updatedLeg.player1Throws.slice(0, updatedLeg.player1Throws.length - (newDartsThisRound - 1));
        } else {
          updatedLeg.player2Remaining = turnStartRemaining;
          updatedLeg.player2Throws = updatedLeg.player2Throws.slice(0, updatedLeg.player2Throws.length - (newDartsThisRound - 1));
        }
        const nextPlayer: 1 | 2 = isP1 ? 2 : 1;
        const nextRemaining = nextPlayer === 1 ? updatedLeg.player1Remaining : updatedLeg.player2Remaining;
        return { ...prev, currentLeg: updatedLeg, currentPlayerId: nextPlayer };
      });
      setDartsThisRound(0);
      // Set turnStartRemaining for the next player
      setTurnStartRemaining(
        isP1 ? game.currentLeg.player2Remaining : game.currentLeg.player1Remaining
      );
      return;
    }

    // Valid throw
    setGame((prev) => {
      if (!prev) return prev;
      const updatedLeg = { ...prev.currentLeg };
      if (isP1) {
        updatedLeg.player1Remaining = newRemaining;
        updatedLeg.player1Throws = [...updatedLeg.player1Throws, dart];
      } else {
        updatedLeg.player2Remaining = newRemaining;
        updatedLeg.player2Throws = [...updatedLeg.player2Throws, dart];
      }

      // Checkout (exactly 0)
      if (newRemaining === 0) {
        updatedLeg.winner = isP1 ? 1 : 2;
        const p1Legs = prev.player1LegsWon + (isP1 ? 1 : 0);
        const p2Legs = prev.player2LegsWon + (isP1 ? 0 : 1);
        const legsToWin = Math.ceil(prev.bestOfLegs / 2);
        const updated: GameState = {
          ...prev,
          currentLeg: updatedLeg,
          player1LegsWon: p1Legs,
          player2LegsWon: p2Legs,
        };

        if (p1Legs >= legsToWin || p2Legs >= legsToWin) {
          updated.isFinished = true;
          updated.winnerName = isP1 ? prev.player1Name : prev.player2Name;
        } else {
          updated.completedLegs = [...prev.completedLegs, updatedLeg];
          const nextStarter: 1 | 2 = isP1 ? 2 : 1;
          updated.currentLeg = createLegState(updatedLeg.legNumber + 1, prev.startScore, nextStarter);
          updated.currentPlayerId = nextStarter;
        }
        return updated;
      }

      // After 3 darts → switch player
      if (newDartsThisRound >= 3) {
        const nextPlayer: 1 | 2 = isP1 ? 2 : 1;
        return { ...prev, currentLeg: updatedLeg, currentPlayerId: nextPlayer };
      }

      return { ...prev, currentLeg: updatedLeg };
    });

    // Handle turn switching
    if (newRemaining === 0) {
      setDartsThisRound(0);
      // turnStart will be set for the next leg's starter
      const startScore = game.startScore;
      setTurnStartRemaining(startScore);
    } else if (newDartsThisRound >= 3) {
      setDartsThisRound(0);
      setTurnStartRemaining(
        isP1 ? game.currentLeg.player2Remaining : game.currentLeg.player1Remaining
      );
    } else {
      setDartsThisRound(newDartsThisRound);
    }
  };

  /** Processes a cricket dart throw with 3-dart turns */
  const handleCricketThrow = () => {
    if (!game || game.isFinished) return;
    const points = selectedScore === 25 && multiplier === 3 ? 0 : selectedScore * multiplier;
    const dart: DartThrow = { baseValue: selectedScore, multiplier, points };
    const targetNumber = selectedScore === 50 ? 25 : selectedScore;
    const newDartsThisRound = dartsThisRound + 1;

    setGame((prev) => {
      if (!prev) return prev;
      const isP1 = prev.currentPlayerId === 1;
      const myState = isP1 ? { ...prev.player1Cricket! } : { ...prev.player2Cricket! };
      const oppState = isP1 ? prev.player2Cricket! : prev.player1Cricket!;

      if (CRICKET_NUMBERS.includes(targetNumber as any) && targetNumber !== 0) {
        const hitsToAdd = selectedScore === 50 ? 2 : multiplier;
        const currentMarks = myState.marks[targetNumber] || 0;
        const newMarks = currentMarks + hitsToAdd;
        myState.marks = { ...myState.marks, [targetNumber]: newMarks };

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
      };

      // Check cricket win
      const allClosed = CRICKET_NUMBERS.every((n) => (myState.marks[n] || 0) >= 3);
      if (allClosed && myState.points >= oppState.points) {
        updatedLeg.winner = isP1 ? 1 : 2;
        updated.isFinished = true;
        updated.winnerName = isP1 ? prev.player1Name : prev.player2Name;
      } else if (newDartsThisRound >= 3) {
        // Switch after 3 darts
        updated.currentPlayerId = isP1 ? 2 : 1;
      }

      return updated;
    });

    if (newDartsThisRound >= 3) {
      setDartsThisRound(0);
    } else {
      setDartsThisRound(newDartsThisRound);
    }
  };

  const throwDart = () => {
    if (game?.mode === "cricket") handleCricketThrow();
    else handleX01Throw();
  };

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

  const resetGame = () => {
    setPhase("setup");
    setGame(null);
    setLegWinnerBanner(null);
    setGameSaved(false);
    setShowDetailedStats(false);
    setDartsThisRound(0);
  };

  const saveGame = async () => {
    if (!game || !game.isFinished || savingRef.current || gameSaved) return;
    savingRef.current = true;
    const allLegs = [...game.completedLegs, game.currentLeg];
    const p1Throws = allLegs.flatMap(l => l.player1Throws);
    const p2Throws = allLegs.flatMap(l => l.player2Throws);
    const p1Avg = calculateAverage(p1Throws);
    const p2Avg = calculateAverage(p2Throws);
    const p1High = getHighestThrow(p1Throws);
    const p2High = getHighestThrow(p2Throws);

    const { data: dbPlayers } = await supabase.from("players").select("id, name");
    const p1Match = dbPlayers?.find(p => p.name === game.player1Name);
    const p2Match = dbPlayers?.find(p => p.name === game.player2Name);
    const winnerMatch = game.winnerName === game.player1Name ? p1Match : p2Match;

    await supabase.from("games").insert({
      user_id: session?.user?.id,
      mode: game.mode,
      start_score: game.startScore,
      best_of_legs: game.bestOfLegs,
      player1_name: game.player1Name,
      player2_name: game.player2Name,
      player1_id: p1Match?.id || null,
      player2_id: p2Match?.id || null,
      player1_legs_won: game.player1LegsWon,
      player2_legs_won: game.player2LegsWon,
      player1_average: p1Avg,
      player2_average: p2Avg,
      player1_highscore: p1High,
      player2_highscore: p2High,
      player1_total_throws: p1Throws.length,
      player2_total_throws: p2Throws.length,
      winner_name: game.winnerName!,
      winner_id: winnerMatch?.id || null,
    });

    for (const { match, avg, high, isWinner } of [
      { match: p1Match, avg: p1Avg, high: p1High, isWinner: game.winnerName === game.player1Name },
      { match: p2Match, avg: p2Avg, high: p2High, isWinner: game.winnerName === game.player2Name },
    ]) {
      if (match) {
        const { data: current } = await supabase.from("players").select("*").eq("id", match.id).single();
        if (current) {
          const gp = current.games_played + 1;
          const newAvg = (Number(current.average) * current.games_played + avg) / gp;
          await supabase.from("players").update({
            games_played: gp,
            games_won: current.games_won + (isWinner ? 1 : 0),
            average: Math.round(newAvg * 10) / 10,
            high_score: Math.max(current.high_score, high),
          }).eq("id", match.id);
        }
      }
    }

    setGameSaved(true);
    savingRef.current = false;
  };

  useEffect(() => {
    if (game?.isFinished && !gameSaved && session?.user?.id) {
      saveGame();
    }
  }, [game?.isFinished]);

  const postGameStats = useMemo(() => {
    if (!game || !game.isFinished) return null;
    const allLegs = [...game.completedLegs, game.currentLeg];
    const p1Throws = allLegs.flatMap((l) => l.player1Throws);
    const p2Throws = allLegs.flatMap((l) => l.player2Throws);
    const p1Doubles = p1Throws.filter(t => t.multiplier === 2);
    const p2Doubles = p2Throws.filter(t => t.multiplier === 2);
    const p1Triples = p1Throws.filter(t => t.multiplier === 3);
    const p2Triples = p2Throws.filter(t => t.multiplier === 3);
    const p1TonPlus = p1Throws.filter(t => t.points >= 100).length;
    const p2TonPlus = p2Throws.filter(t => t.points >= 100).length;
    return {
      player1Average: calculateAverage(p1Throws),
      player2Average: calculateAverage(p2Throws),
      player1Highscore: getHighestThrow(p1Throws),
      player2Highscore: getHighestThrow(p2Throws),
      p1TotalThrows: p1Throws.length,
      p2TotalThrows: p2Throws.length,
      p1Doubles: p1Doubles.length,
      p2Doubles: p2Doubles.length,
      p1Triples: p1Triples.length,
      p2Triples: p2Triples.length,
      p1TonPlus,
      p2TonPlus,
      p1TotalPoints: p1Throws.reduce((s, t) => s + t.points, 0),
      p2TotalPoints: p2Throws.reduce((s, t) => s + t.points, 0),
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
            {[
              { label: "Spieler 1", value: p1Name, setter: setP1Name },
              { label: "Spieler 2", value: p2Name, setter: setP2Name },
            ].map((p) => (
              <div key={p.label}>
                <label className="text-sm text-muted-foreground mb-1 block">{p.label}</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground text-left flex items-center justify-between">
                      <span className="truncate">{p.value}</span>
                      <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="start">
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {dbPlayers.map((dp) => (
                        <button
                          key={dp.id}
                          onClick={() => p.setter(dp.name)}
                          className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
                            p.value === dp.name ? "bg-primary/15 text-primary" : "hover:bg-muted"
                          }`}
                        >
                          <span>{dp.emoji}</span>
                          <span>{dp.name}</span>
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-border mt-2 pt-2">
                      <input
                        value={p.value}
                        onChange={(e) => p.setter(e.target.value)}
                        placeholder="Oder Name eingeben..."
                        className="w-full rounded bg-muted border-0 px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            ))}
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
        <div className="fixed inset-0 bg-background/85 backdrop-blur-sm z-50 flex items-center justify-center overflow-y-auto py-8">
          <div className="bg-card border border-primary/30 rounded-2xl p-8 text-center animate-scale-in max-w-md mx-4 glow-cyan">
            <Trophy className="w-16 h-16 text-accent mx-auto mb-4" />
            <h2 className="text-3xl font-display uppercase mb-1">{game.winnerName}</h2>
            <p className="text-accent font-display text-xl uppercase mb-4">Gewinnt!</p>
            {game.bestOfLegs > 1 && (
              <p className="text-sm text-muted-foreground mb-4">{game.player1LegsWon} : {game.player2LegsWon} Legs</p>
            )}

            {postGameStats && (
              <div className="grid grid-cols-2 gap-3 mb-4 text-left">
                {[
                  { label: game.player1Name, avg: postGameStats.player1Average, high: postGameStats.player1Highscore, throws: postGameStats.p1TotalThrows, legs: game.player1LegsWon },
                  { label: game.player2Name, avg: postGameStats.player2Average, high: postGameStats.player2Highscore, throws: postGameStats.p2TotalThrows, legs: game.player2LegsWon },
                ].map((p) => (
                  <div key={p.label} className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
                    <p className="font-semibold text-sm truncate">{p.label}</p>
                    <p className="text-muted-foreground">Ø <span className="text-foreground font-bold">{p.avg.toFixed(1)}</span></p>
                    <p className="text-muted-foreground">High <span className="text-foreground font-bold">{p.high}</span></p>
                    <p className="text-muted-foreground">Würfe <span className="text-foreground font-bold">{p.throws}</span></p>
                  </div>
                ))}
              </div>
            )}

            {postGameStats && (
              <button onClick={() => setShowDetailedStats(!showDetailedStats)}
                className="text-xs text-primary underline mb-4 block mx-auto">
                {showDetailedStats ? "Weniger anzeigen" : "Detaillierte Statistiken anzeigen"}
              </button>
            )}

            {showDetailedStats && postGameStats && (
              <div className="bg-muted/30 rounded-lg p-4 mb-4 text-xs">
                <div className="grid grid-cols-3 gap-y-2">
                  <span className="font-semibold text-primary text-right pr-3">{game.player1Name}</span>
                  <span className="text-muted-foreground text-center">Statistik</span>
                  <span className="font-semibold text-secondary pl-3">{game.player2Name}</span>

                  <span className="text-right pr-3 font-display">{postGameStats.player1Average.toFixed(1)}</span>
                  <span className="text-center text-muted-foreground">Ø Average</span>
                  <span className="pl-3 font-display">{postGameStats.player2Average.toFixed(1)}</span>

                  <span className="text-right pr-3 font-display">{postGameStats.player1Highscore}</span>
                  <span className="text-center text-muted-foreground">Highscore</span>
                  <span className="pl-3 font-display">{postGameStats.player2Highscore}</span>

                  <span className="text-right pr-3 font-display">{postGameStats.p1TotalThrows}</span>
                  <span className="text-center text-muted-foreground">Würfe</span>
                  <span className="pl-3 font-display">{postGameStats.p2TotalThrows}</span>

                  <span className="text-right pr-3 font-display">{postGameStats.p1Doubles}</span>
                  <span className="text-center text-muted-foreground">Doubles</span>
                  <span className="pl-3 font-display">{postGameStats.p2Doubles}</span>

                  <span className="text-right pr-3 font-display">{postGameStats.p1Triples}</span>
                  <span className="text-center text-muted-foreground">Triples</span>
                  <span className="pl-3 font-display">{postGameStats.p2Triples}</span>

                  <span className="text-right pr-3 font-display">{postGameStats.p1TonPlus}</span>
                  <span className="text-center text-muted-foreground">100+ Würfe</span>
                  <span className="pl-3 font-display">{postGameStats.p2TonPlus}</span>

                  <span className="text-right pr-3 font-display">{postGameStats.p1TotalPoints}</span>
                  <span className="text-center text-muted-foreground">Gesamtpunkte</span>
                  <span className="pl-3 font-display">{postGameStats.p2TotalPoints}</span>
                </div>
              </div>
            )}

            <Button onClick={() => { resetGame(); navigate("/game"); }} className="w-full font-display uppercase">
              Neues Spiel
            </Button>

            {gameSaved && <p className="text-[10px] text-muted-foreground mt-2">✓ Spiel gespeichert</p>}
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

      {/* Current player indicator with dart counter */}
      <div className="text-center mb-3">
        <span className="text-sm text-primary font-medium">{currentPlayerName} wirft</span>
        <div className="flex justify-center gap-1 mt-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`w-3 h-3 rounded-full transition-all ${
                i < dartsThisRound ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground">Dart {dartsThisRound + 1} / 3</span>
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
