import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { RotateCcw, Trophy, Target, Edit2, X, Users, Undo2, Volume2, VolumeX, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import DartScoreInput from "@/components/game/DartScoreInput";
import CheckoutSuggestion from "@/components/game/CheckoutSuggestion";
import LiveCamera, { type DetectedDart } from "@/components/game/LiveCamera";
import type { GameMode, GameState, LegState, DartThrow, CricketPlayerState } from "@/types/game";
import { CRICKET_NUMBERS } from "@/types/game";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import {
  playThrowSound, playBustSound, play180Sound, playCheckoutSound,
  playVictorySound, playTonPlusSound, playTurnSwitchSound,
} from "@/utils/sounds";

function createLegState(legNumber: number, startScore: number, startingPlayer: 1 | 2): LegState {
  return { legNumber, startingPlayerId: startingPlayer, player1Remaining: startScore, player2Remaining: startScore, player1Throws: [], player2Throws: [] };
}
function createCricketState(): CricketPlayerState {
  const marks: Record<number, number> = {};
  CRICKET_NUMBERS.forEach((n) => (marks[n] = 0));
  return { marks, points: 0 };
}
function calculateAverage(throws: DartThrow[]): number {
  if (throws.length === 0) return 0;
  return (throws.reduce((sum, t) => sum + t.points, 0) / throws.length) * 3;
}
function getHighestThrow(throws: DartThrow[]): number {
  return throws.reduce((max, t) => Math.max(max, t.points), 0);
}

/** Calculate highest 3-dart round from throws */
function getHighest3DartRound(throws: DartThrow[]): number {
  let max = 0;
  for (let i = 0; i < throws.length; i += 3) {
    const round = throws.slice(i, i + 3).reduce((s, t) => s + t.points, 0);
    if (round > max) max = round;
  }
  return max;
}

/** Get first 9 darts average */
function getFirst9Average(throws: DartThrow[]): number {
  const first9 = throws.slice(0, 9);
  if (first9.length === 0) return 0;
  return (first9.reduce((s, t) => s + t.points, 0) / first9.length) * 3;
}

/** Count 3-dart rounds scoring 100+ */
function countTonPlusRounds(throws: DartThrow[]): number {
  let count = 0;
  for (let i = 0; i < throws.length; i += 3) {
    const round = throws.slice(i, i + 3).reduce((s, t) => s + t.points, 0);
    if (round >= 100) count++;
  }
  return count;
}

/** Count 180s */
function count180s(throws: DartThrow[]): number {
  let count = 0;
  for (let i = 0; i < throws.length; i += 3) {
    const round = throws.slice(i, i + 3).reduce((s, t) => s + t.points, 0);
    if (round === 180) count++;
  }
  return count;
}

interface DbPlayer { id: string; name: string; emoji: string; }

/** Undo snapshot for reverting last dart */
interface UndoSnapshot {
  game: GameState;
  dartsThisRound: number;
  turnStartRemaining: number;
}

const GamePage = () => {
  const [phase, setPhase] = useState<"setup" | "playing" | "postGame">("setup");
  const [mode, setMode] = useState<GameMode>("501");
  const [bestOfLegs, setBestOfLegs] = useState(1);
  const [customStartScore, setCustomStartScore] = useState(501);
  const [p1Name, setP1Name] = useState("Spieler 1");
  const [p2Name, setP2Name] = useState("Spieler 2");
  const [doubleOut, setDoubleOut] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [game, setGame] = useState<GameState | null>(null);
  const [selectedScore, setSelectedScore] = useState(20);
  const [multiplier, setMultiplier] = useState(1);
  const [editingThrowIdx, setEditingThrowIdx] = useState<number | null>(null);
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [gameSaved, setGameSaved] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();
  const savingRef = useRef(false);
  const [dbPlayers, setDbPlayers] = useState<DbPlayer[]>([]);
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [cameraEnabled, setCameraEnabled] = useState(false);

  useEffect(() => {
    supabase.from("players").select("id, name, emoji").order("name").then(({ data }) => {
      if (data) setDbPlayers(data);
    });
  }, []);

  const [dartsThisRound, setDartsThisRound] = useState(0);
  const [turnStartRemaining, setTurnStartRemaining] = useState<number>(0);

  /** 3-dart round scores for display during game */
  const currentRoundScores = useMemo(() => {
    if (!game) return [];
    const isP1 = game.currentPlayerId === 1;
    const throws = isP1 ? game.currentLeg.player1Throws : game.currentLeg.player2Throws;
    // Get the last N darts where N = dartsThisRound
    return throws.slice(-dartsThisRound);
  }, [game, dartsThisRound]);

  const currentRoundTotal = currentRoundScores.reduce((s, t) => s + t.points, 0);

  const getStartScore = (): number => {
    if (mode === "cricket") return 0;
    if (mode === "custom") return customStartScore;
    return parseInt(mode);
  };

  const startGame = () => {
    const startScore = getStartScore();
    const newGame: GameState = {
      mode, startScore, bestOfLegs, player1Name: p1Name, player2Name: p2Name,
      player1LegsWon: 0, player2LegsWon: 0,
      currentLeg: createLegState(1, startScore, 1), completedLegs: [],
      currentPlayerId: 1, isFinished: false,
    };
    if (mode === "cricket") {
      newGame.player1Cricket = createCricketState();
      newGame.player2Cricket = createCricketState();
    }
    setGame(newGame);
    setPhase("playing");
    setDartsThisRound(0);
    setTurnStartRemaining(startScore);
    setUndoStack([]);
  };

  /** Save undo snapshot before each throw */
  const saveUndo = () => {
    if (!game) return;
    setUndoStack(prev => [...prev.slice(-20), { game: JSON.parse(JSON.stringify(game)), dartsThisRound, turnStartRemaining }]);
  };

  /** Undo the last dart throw */
  const undoLastDart = () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setGame(last.game);
    setDartsThisRound(last.dartsThisRound);
    setTurnStartRemaining(last.turnStartRemaining);
    setUndoStack(prev => prev.slice(0, -1));
    if (soundEnabled) playThrowSound();
  };

  const handleX01Throw = (overrideBase?: number, overrideMul?: 1 | 2 | 3) => {
    if (!game || game.isFinished) return;
    saveUndo();

    const baseValue = overrideBase ?? selectedScore;
    const mul = overrideMul ?? multiplier;
    const points = baseValue === 25 && mul === 3 ? 0 : baseValue * mul;
    const dart: DartThrow = { baseValue, multiplier: mul, points };
    const isP1 = game.currentPlayerId === 1;
    const remaining = isP1 ? game.currentLeg.player1Remaining : game.currentLeg.player2Remaining;
    const newRemaining = remaining - points;
    const newDartsThisRound = dartsThisRound + 1;

    // Bust checks: below 0, equals 1, or equals 0 but checkout not on double (if double-out enabled)
    const isBust = newRemaining < 0 || newRemaining === 1 ||
      (newRemaining === 0 && doubleOut && mul !== 2 && !(baseValue === 25 && mul === 2));

    if (isBust) {
      if (soundEnabled) playBustSound();
      setGame((prev) => {
        if (!prev) return prev;
        const updatedLeg = { ...prev.currentLeg };
        if (isP1) {
          updatedLeg.player1Remaining = turnStartRemaining;
          updatedLeg.player1Throws = updatedLeg.player1Throws.slice(0, updatedLeg.player1Throws.length - (newDartsThisRound - 1));
        } else {
          updatedLeg.player2Remaining = turnStartRemaining;
          updatedLeg.player2Throws = updatedLeg.player2Throws.slice(0, updatedLeg.player2Throws.length - (newDartsThisRound - 1));
        }
        const nextPlayer: 1 | 2 = isP1 ? 2 : 1;
        return { ...prev, currentLeg: updatedLeg, currentPlayerId: nextPlayer };
      });
      setDartsThisRound(0);
      setTurnStartRemaining(isP1 ? game.currentLeg.player2Remaining : game.currentLeg.player1Remaining);
      if (soundEnabled) setTimeout(() => playTurnSwitchSound(), 300);
      return;
    }

    if (soundEnabled) playThrowSound();

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

      // Checkout
      if (newRemaining === 0) {
        updatedLeg.winner = isP1 ? 1 : 2;
        const p1Legs = prev.player1LegsWon + (isP1 ? 1 : 0);
        const p2Legs = prev.player2LegsWon + (isP1 ? 0 : 1);
        const legsToWin = Math.ceil(prev.bestOfLegs / 2);
        const updated: GameState = { ...prev, currentLeg: updatedLeg, player1LegsWon: p1Legs, player2LegsWon: p2Legs };

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

      // After 3 darts → switch
      if (newDartsThisRound >= 3) {
        const nextPlayer: 1 | 2 = isP1 ? 2 : 1;
        return { ...prev, currentLeg: updatedLeg, currentPlayerId: nextPlayer };
      }

      return { ...prev, currentLeg: updatedLeg };
    });

    // Sound & haptic for special scores
    if (newRemaining === 0) {
      setDartsThisRound(0);
      setTurnStartRemaining(game.startScore);
      // Check if match is won for victory sound
      const p1Legs = game.player1LegsWon + (isP1 ? 1 : 0);
      const p2Legs = game.player2LegsWon + (isP1 ? 0 : 1);
      const legsToWin = Math.ceil(game.bestOfLegs / 2);
      if (soundEnabled) {
        if (p1Legs >= legsToWin || p2Legs >= legsToWin) {
          setTimeout(() => playVictorySound(), 200);
        } else {
          setTimeout(() => playCheckoutSound(), 100);
        }
      }
    } else if (newDartsThisRound >= 3) {
      // Check round total for sound effects
      const roundThrows = isP1 ? game.currentLeg.player1Throws.slice(-2) : game.currentLeg.player2Throws.slice(-2);
      const roundTotal = roundThrows.reduce((s, t) => s + t.points, 0) + points;
      if (soundEnabled) {
        if (roundTotal === 180) setTimeout(() => play180Sound(), 100);
        else if (roundTotal >= 100) setTimeout(() => playTonPlusSound(), 100);
        else setTimeout(() => playTurnSwitchSound(), 100);
      }
      setDartsThisRound(0);
      setTurnStartRemaining(isP1 ? game.currentLeg.player2Remaining : game.currentLeg.player1Remaining);
    } else {
      setDartsThisRound(newDartsThisRound);
    }
  };

  const handleCricketThrow = (overrideBase?: number, overrideMul?: 1 | 2 | 3) => {
    if (!game || game.isFinished) return;
    saveUndo();
    const baseValue = overrideBase ?? selectedScore;
    const mul = overrideMul ?? multiplier;
    const points = baseValue === 25 && mul === 3 ? 0 : baseValue * mul;
    const dart: DartThrow = { baseValue, multiplier: mul, points };
    const targetNumber = baseValue === 50 ? 25 : baseValue;
    const newDartsThisRound = dartsThisRound + 1;

    if (soundEnabled) playThrowSound();

    setGame((prev) => {
      if (!prev) return prev;
      const isP1 = prev.currentPlayerId === 1;
      const myState = isP1 ? { ...prev.player1Cricket! } : { ...prev.player2Cricket! };
      const oppState = isP1 ? prev.player2Cricket! : prev.player1Cricket!;

      if (CRICKET_NUMBERS.includes(targetNumber as any) && targetNumber !== 0) {
        const hitsToAdd = baseValue === 50 ? 2 : mul;
        const currentMarks = myState.marks[targetNumber] || 0;
        const newMarks = currentMarks + hitsToAdd;
        myState.marks = { ...myState.marks, [targetNumber]: newMarks };
        if (newMarks > 3 && (oppState.marks[targetNumber] || 0) < 3) {
          const scorableHits = newMarks - Math.max(currentMarks, 3);
          myState.points += targetNumber * scorableHits;
        }
      }

      const updatedLeg = { ...prev.currentLeg };
      if (isP1) updatedLeg.player1Throws = [...updatedLeg.player1Throws, dart];
      else updatedLeg.player2Throws = [...updatedLeg.player2Throws, dart];

      const updated: GameState = {
        ...prev, currentLeg: updatedLeg,
        player1Cricket: isP1 ? myState : prev.player1Cricket,
        player2Cricket: isP1 ? prev.player2Cricket : myState,
      };

      const allClosed = CRICKET_NUMBERS.every((n) => (myState.marks[n] || 0) >= 3);
      if (allClosed && myState.points >= oppState.points) {
        updatedLeg.winner = isP1 ? 1 : 2;
        updated.isFinished = true;
        updated.winnerName = isP1 ? prev.player1Name : prev.player2Name;
      } else if (newDartsThisRound >= 3) {
        updated.currentPlayerId = isP1 ? 2 : 1;
      }
      return updated;
    });

    if (newDartsThisRound >= 3) {
      if (soundEnabled) setTimeout(() => playTurnSwitchSound(), 100);
      setDartsThisRound(0);
    } else {
      setDartsThisRound(newDartsThisRound);
    }
  };

  const throwDart = () => {
    if (game?.mode === "cricket") handleCricketThrow();
    else handleX01Throw();
  };

  /**
   * Atomically commit a full round of camera-detected darts.
   * Processes all darts in a single state update so dartsThisRound /
   * turnStartRemaining stay consistent across the round.
   */
  const submitDetectedRound = (darts: DetectedDart[]) => {
    if (!game || game.isFinished || darts.length === 0) return;

    // Snapshot for undo (one entry per camera round).
    setUndoStack(prev => [...prev.slice(-20), {
      game: JSON.parse(JSON.stringify(game)),
      dartsThisRound,
      turnStartRemaining,
    }]);

    let curGame: GameState = JSON.parse(JSON.stringify(game));
    let curDarts = dartsThisRound;
    let curStart = turnStartRemaining;
    let busted = false;
    let checkedOut = false;
    let roundTotal = 0;

    const dartsToApply = darts.slice(0, 3);

    for (const d of dartsToApply) {
      if (curGame.isFinished) break;
      const isP1 = curGame.currentPlayerId === 1;
      const points = d.baseValue === 25 && d.multiplier === 3 ? 0 : d.baseValue * d.multiplier;
      const dart: DartThrow = { baseValue: d.baseValue, multiplier: d.multiplier, points };

      if (curGame.mode === "cricket") {
        const myState = isP1 ? { ...curGame.player1Cricket! } : { ...curGame.player2Cricket! };
        const oppState = isP1 ? curGame.player2Cricket! : curGame.player1Cricket!;
        const targetNumber = d.baseValue === 50 ? 25 : d.baseValue;
        if (CRICKET_NUMBERS.includes(targetNumber as any) && targetNumber !== 0) {
          const hitsToAdd = d.baseValue === 50 ? 2 : d.multiplier;
          const currentMarks = myState.marks[targetNumber] || 0;
          const newMarks = currentMarks + hitsToAdd;
          myState.marks = { ...myState.marks, [targetNumber]: newMarks };
          if (newMarks > 3 && (oppState.marks[targetNumber] || 0) < 3) {
            const scorableHits = newMarks - Math.max(currentMarks, 3);
            myState.points += targetNumber * scorableHits;
          }
        }
        if (isP1) {
          curGame.player1Cricket = myState;
          curGame.currentLeg.player1Throws = [...curGame.currentLeg.player1Throws, dart];
        } else {
          curGame.player2Cricket = myState;
          curGame.currentLeg.player2Throws = [...curGame.currentLeg.player2Throws, dart];
        }
        const allClosed = CRICKET_NUMBERS.every((n) => (myState.marks[n] || 0) >= 3);
        if (allClosed && myState.points >= oppState.points) {
          curGame.currentLeg.winner = isP1 ? 1 : 2;
          curGame.isFinished = true;
          curGame.winnerName = isP1 ? curGame.player1Name : curGame.player2Name;
          checkedOut = true;
        }
        curDarts += 1;
        continue;
      }

      // X01 modes
      const remaining = isP1 ? curGame.currentLeg.player1Remaining : curGame.currentLeg.player2Remaining;
      const newRemaining = remaining - points;
      const newDartsThisRound = curDarts + 1;
      const mul: number = d.multiplier;
      const isDoubleOut = mul === 2;
      const isBust = newRemaining < 0 || newRemaining === 1 ||
        (newRemaining === 0 && doubleOut && !isDoubleOut);

      if (isBust) {
        if (isP1) {
          curGame.currentLeg.player1Remaining = curStart;
          curGame.currentLeg.player1Throws = curGame.currentLeg.player1Throws.slice(
            0, curGame.currentLeg.player1Throws.length - (newDartsThisRound - 1)
          );
        } else {
          curGame.currentLeg.player2Remaining = curStart;
          curGame.currentLeg.player2Throws = curGame.currentLeg.player2Throws.slice(
            0, curGame.currentLeg.player2Throws.length - (newDartsThisRound - 1)
          );
        }
        busted = true;
        break;
      }

      if (isP1) {
        curGame.currentLeg.player1Remaining = newRemaining;
        curGame.currentLeg.player1Throws = [...curGame.currentLeg.player1Throws, dart];
      } else {
        curGame.currentLeg.player2Remaining = newRemaining;
        curGame.currentLeg.player2Throws = [...curGame.currentLeg.player2Throws, dart];
      }
      curDarts = newDartsThisRound;
      roundTotal += points;

      if (newRemaining === 0) {
        curGame.currentLeg.winner = isP1 ? 1 : 2;
        const p1Legs = curGame.player1LegsWon + (isP1 ? 1 : 0);
        const p2Legs = curGame.player2LegsWon + (isP1 ? 0 : 1);
        const legsToWin = Math.ceil(curGame.bestOfLegs / 2);
        curGame.player1LegsWon = p1Legs;
        curGame.player2LegsWon = p2Legs;
        if (p1Legs >= legsToWin || p2Legs >= legsToWin) {
          curGame.isFinished = true;
          curGame.winnerName = isP1 ? curGame.player1Name : curGame.player2Name;
        } else {
          curGame.completedLegs = [...curGame.completedLegs, curGame.currentLeg];
          const nextStarter: 1 | 2 = isP1 ? 2 : 1;
          curGame.currentLeg = createLegState(curGame.currentLeg.legNumber + 1, curGame.startScore, nextStarter);
          curGame.currentPlayerId = nextStarter;
        }
        checkedOut = true;
        break;
      }
    }

    if (!curGame.isFinished) {
      // Always advance to next player after a camera-committed round
      // (player pulled the darts → their turn is over).
      if (busted || curDarts >= 1) {
        const isP1 = curGame.currentPlayerId === 1;
        const nextPlayer: 1 | 2 = isP1 ? 2 : 1;
        curGame.currentPlayerId = nextPlayer;
        curStart = isP1 ? curGame.currentLeg.player2Remaining : curGame.currentLeg.player1Remaining;
        curDarts = 0;
      }
    } else {
      curDarts = 0;
    }

    setGame(curGame);
    setDartsThisRound(curDarts);
    setTurnStartRemaining(curStart);

    if (soundEnabled) {
      if (checkedOut) {
        setTimeout(() => playCheckoutSound(), 100);
      } else if (busted) {
        playBustSound();
      } else if (roundTotal === 180) {
        setTimeout(() => play180Sound(), 100);
      } else if (roundTotal >= 100) {
        setTimeout(() => playTonPlusSound(), 100);
      } else {
        setTimeout(() => playTurnSwitchSound(), 100);
      }
    }
  };

  const deleteThrow = (playerNum: 1 | 2, throwIndex: number) => {
    setGame((prev) => {
      if (!prev) return prev;
      const isP1 = playerNum === 1;
      const throws = isP1 ? [...prev.currentLeg.player1Throws] : [...prev.currentLeg.player2Throws];
      const removed = throws.splice(throwIndex, 1)[0];
      const updatedLeg = { ...prev.currentLeg };
      if (isP1) { updatedLeg.player1Throws = throws; updatedLeg.player1Remaining += removed.points; }
      else { updatedLeg.player2Throws = throws; updatedLeg.player2Remaining += removed.points; }
      return { ...prev, currentLeg: updatedLeg };
    });
    setEditingThrowIdx(null);
  };

  /**
   * Decompose a 3-dart round total into 3 plausible darts for quick entry.
   * Not optimal-checkout-aware; use manual entry to finish on a double.
   */
  const splitQuickRound = (total: number): DetectedDart[] => {
    let rem = total;
    const out: DetectedDart[] = [];
    for (let i = 0; i < 3; i++) {
      const dartsLeft = 3 - i;
      let pts = i === 2 ? rem : Math.min(60, Math.ceil(rem / dartsLeft));
      if (rem - pts > 60 * (dartsLeft - 1)) pts = rem - 60 * (dartsLeft - 1);
      pts = Math.max(0, Math.min(60, pts));
      let base = pts;
      let mul: 1 | 2 | 3 = 1;
      if (pts === 0) { base = 0; mul = 1; }
      else if (pts <= 20) { base = pts; mul = 1; }
      else if (pts === 25) { base = 25; mul = 1; }
      else if (pts === 50) { base = 25; mul = 2; }
      else if (pts % 3 === 0 && pts / 3 <= 20) { base = pts / 3; mul = 3; }
      else if (pts % 2 === 0 && pts / 2 <= 20) { base = pts / 2; mul = 2; }
      else { base = 20; mul = 1; pts = 20; }
      out.push({ baseValue: base, multiplier: mul, points: pts, confidence: 1 });
      rem -= pts;
    }
    return out;
  };

  const handleQuickRound = (total: number) => {
    if (!game || game.isFinished) return;
    if (game.mode === "cricket") return;
    submitDetectedRound(splitQuickRound(total));
  };

  const resetGame = () => {
    setPhase("setup"); setGame(null); setGameSaved(false); setShowDetailedStats(false);
    setDartsThisRound(0); setUndoStack([]);
  };

  const saveGame = async () => {
    if (!game || !game.isFinished || savingRef.current || gameSaved) return;
    savingRef.current = true;
    const allLegs = [...game.completedLegs, game.currentLeg];
    const p1Throws = allLegs.flatMap(l => l.player1Throws);
    const p2Throws = allLegs.flatMap(l => l.player2Throws);
    const p1Avg = calculateAverage(p1Throws);
    const p2Avg = calculateAverage(p2Throws);
    const p1High = getHighest3DartRound(p1Throws);
    const p2High = getHighest3DartRound(p2Throws);

    const { data: dbPlayers } = await supabase.from("players").select("id, name");
    const p1Match = dbPlayers?.find(p => p.name === game.player1Name);
    const p2Match = dbPlayers?.find(p => p.name === game.player2Name);
    const winnerMatch = game.winnerName === game.player1Name ? p1Match : p2Match;

    await supabase.from("games").insert({
      user_id: session?.user?.id, mode: game.mode, start_score: game.startScore,
      best_of_legs: game.bestOfLegs, player1_name: game.player1Name, player2_name: game.player2Name,
      player1_id: p1Match?.id || null, player2_id: p2Match?.id || null,
      player1_legs_won: game.player1LegsWon, player2_legs_won: game.player2LegsWon,
      player1_average: p1Avg, player2_average: p2Avg,
      player1_highscore: p1High, player2_highscore: p2High,
      player1_total_throws: p1Throws.length, player2_total_throws: p2Throws.length,
      winner_name: game.winnerName!, winner_id: winnerMatch?.id || null,
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
            games_played: gp, games_won: current.games_won + (isWinner ? 1 : 0),
            average: Math.round(newAvg * 10) / 10, high_score: Math.max(current.high_score, high),
          }).eq("id", match.id);
        }
      }
    }
    setGameSaved(true);
    savingRef.current = false;
  };

  useEffect(() => {
    if (game?.isFinished && !gameSaved && session?.user?.id) saveGame();
  }, [game?.isFinished]);

  const postGameStats = useMemo(() => {
    if (!game || !game.isFinished) return null;
    const allLegs = [...game.completedLegs, game.currentLeg];
    const p1Throws = allLegs.flatMap((l) => l.player1Throws);
    const p2Throws = allLegs.flatMap((l) => l.player2Throws);
    return {
      player1Average: calculateAverage(p1Throws),
      player2Average: calculateAverage(p2Throws),
      player1Highscore: getHighest3DartRound(p1Throws),
      player2Highscore: getHighest3DartRound(p2Throws),
      p1TotalThrows: p1Throws.length,
      p2TotalThrows: p2Throws.length,
      p1Doubles: p1Throws.filter(t => t.multiplier === 2).length,
      p2Doubles: p2Throws.filter(t => t.multiplier === 2).length,
      p1Triples: p1Throws.filter(t => t.multiplier === 3).length,
      p2Triples: p2Throws.filter(t => t.multiplier === 3).length,
      p1TonPlus: countTonPlusRounds(p1Throws),
      p2TonPlus: countTonPlusRounds(p2Throws),
      p1_180s: count180s(p1Throws),
      p2_180s: count180s(p2Throws),
      p1First9: getFirst9Average(p1Throws),
      p2First9: getFirst9Average(p2Throws),
      p1TotalPoints: p1Throws.reduce((s, t) => s + t.points, 0),
      p2TotalPoints: p2Throws.reduce((s, t) => s + t.points, 0),
    };
  }, [game?.isFinished]);

  // ─── SETUP PHASE ───────────────────────────────
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
              <input type="number" value={customStartScore} onChange={(e) => setCustomStartScore(parseInt(e.target.value) || 0)}
                className="w-full rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground" />
            </div>
          )}

          {mode !== "cricket" && (
            <>
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

              {/* Double-Out toggle */}
              <div className="flex items-center justify-between bg-card rounded-lg border border-border px-4 py-3">
                <div>
                  <Label className="text-sm font-medium">Double Out</Label>
                  <p className="text-xs text-muted-foreground">Checkout muss auf Doppelfeld enden</p>
                </div>
                <Switch checked={doubleOut} onCheckedChange={setDoubleOut} />
              </div>
            </>
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
                        <button key={dp.id} onClick={() => p.setter(dp.name)}
                          className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${p.value === dp.name ? "bg-primary/15 text-primary" : "hover:bg-muted"}`}>
                          <span>{dp.emoji}</span><span>{dp.name}</span>
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-border mt-2 pt-2">
                      <input value={p.value} onChange={(e) => p.setter(e.target.value)} placeholder="Oder Name eingeben..."
                        className="w-full rounded bg-muted border-0 px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            ))}
          </div>

          {/* Sound toggle */}
          <div className="flex items-center justify-between bg-card rounded-lg border border-border px-4 py-3">
            <div className="flex items-center gap-2">
              {soundEnabled ? <Volume2 className="w-4 h-4 text-primary" /> : <VolumeX className="w-4 h-4 text-muted-foreground" />}
              <Label className="text-sm font-medium">Sound & Haptik</Label>
            </div>
            <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
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
            {game.bestOfLegs > 1 && <p className="text-sm text-muted-foreground mb-4">{game.player1LegsWon} : {game.player2LegsWon} Legs</p>}

            {postGameStats && (
              <div className="grid grid-cols-2 gap-3 mb-4 text-left">
                {[
                  { label: game.player1Name, avg: postGameStats.player1Average, high: postGameStats.player1Highscore, throws: postGameStats.p1TotalThrows, legs: game.player1LegsWon, s180: postGameStats.p1_180s, ton: postGameStats.p1TonPlus, first9: postGameStats.p1First9 },
                  { label: game.player2Name, avg: postGameStats.player2Average, high: postGameStats.player2Highscore, throws: postGameStats.p2TotalThrows, legs: game.player2LegsWon, s180: postGameStats.p2_180s, ton: postGameStats.p2TonPlus, first9: postGameStats.p2First9 },
                ].map((p) => (
                  <div key={p.label} className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
                    <p className="font-semibold text-sm truncate">{p.label}</p>
                    <p className="text-muted-foreground">Ø <span className="text-foreground font-bold">{p.avg.toFixed(1)}</span></p>
                    <p className="text-muted-foreground">High <span className="text-foreground font-bold">{p.high}</span></p>
                    <p className="text-muted-foreground">First 9 <span className="text-foreground font-bold">{p.first9.toFixed(1)}</span></p>
                    {p.s180 > 0 && <p className="text-accent font-bold">🎯 {p.s180}× 180!</p>}
                    {p.ton > 0 && <p className="text-muted-foreground">100+ <span className="text-foreground font-bold">{p.ton}×</span></p>}
                  </div>
                ))}
              </div>
            )}

            {postGameStats && (
              <button onClick={() => setShowDetailedStats(!showDetailedStats)} className="text-xs text-primary underline mb-4 block mx-auto">
                {showDetailedStats ? "Weniger anzeigen" : "Detaillierte Statistiken"}
              </button>
            )}

            {showDetailedStats && postGameStats && (
              <div className="bg-muted/30 rounded-lg p-4 mb-4 text-xs">
                <div className="grid grid-cols-3 gap-y-2">
                  <span className="font-semibold text-primary text-right pr-3">{game.player1Name}</span>
                  <span className="text-muted-foreground text-center">Statistik</span>
                  <span className="font-semibold text-secondary pl-3">{game.player2Name}</span>

                  {[
                    { l: "Ø Average", v1: postGameStats.player1Average.toFixed(1), v2: postGameStats.player2Average.toFixed(1) },
                    { l: "First 9 Ø", v1: postGameStats.p1First9.toFixed(1), v2: postGameStats.p2First9.toFixed(1) },
                    { l: "Highscore", v1: postGameStats.player1Highscore, v2: postGameStats.player2Highscore },
                    { l: "Würfe", v1: postGameStats.p1TotalThrows, v2: postGameStats.p2TotalThrows },
                    { l: "Doubles", v1: postGameStats.p1Doubles, v2: postGameStats.p2Doubles },
                    { l: "Triples", v1: postGameStats.p1Triples, v2: postGameStats.p2Triples },
                    { l: "100+", v1: postGameStats.p1TonPlus, v2: postGameStats.p2TonPlus },
                    { l: "180!", v1: postGameStats.p1_180s, v2: postGameStats.p2_180s },
                    { l: "Punkte", v1: postGameStats.p1TotalPoints, v2: postGameStats.p2TotalPoints },
                  ].map(row => (
                    <span key={row.l} className="contents">
                      <span className="text-right pr-3 font-display">{row.v1}</span>
                      <span className="text-center text-muted-foreground">{row.l}</span>
                      <span className="pl-3 font-display">{row.v2}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <Button onClick={() => { resetGame(); navigate("/game"); }} className="w-full font-display uppercase">Neues Spiel</Button>
            {gameSaved && <p className="text-[10px] text-muted-foreground mt-2">✓ Spiel gespeichert</p>}
          </div>
        </div>
      )}

      {/* Scoreboard */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {[
          { name: game.player1Name, remaining: game.currentLeg.player1Remaining, throws: game.currentLeg.player1Throws, legs: game.player1LegsWon, playerId: 1 as const, cricket: game.player1Cricket },
          { name: game.player2Name, remaining: game.currentLeg.player2Remaining, throws: game.currentLeg.player2Throws, legs: game.player2LegsWon, playerId: 2 as const, cricket: game.player2Cricket },
        ].map((p) => {
          const avg = calculateAverage(p.throws);
          const p180 = count180s(p.throws);
          return (
            <div key={p.playerId}
              className={`bg-card rounded-xl p-4 border-2 transition-all text-center ${game.currentPlayerId === p.playerId ? "border-primary glow-cyan" : "border-border"}`}>
              <p className="text-sm text-muted-foreground truncate">{p.name}</p>
              <p className="text-4xl font-display mt-1">{isCricket ? p.cricket?.points ?? 0 : p.remaining}</p>
              <div className="flex justify-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>Ø {avg.toFixed(1)}</span>
                {game.bestOfLegs > 1 && <span className="text-primary font-bold">{p.legs} Legs</span>}
                {p180 > 0 && <span className="text-accent font-bold">🎯{p180}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Leg info bar */}
      {game.bestOfLegs > 1 && (
        <div className="text-center text-xs text-muted-foreground mb-2">
          Leg {game.currentLeg.legNumber} · {game.currentLeg.startingPlayerId === 1 ? game.player1Name : game.player2Name} fängt an
        </div>
      )}

      {/* Current player indicator with dart counter + round score */}
      <div className="text-center mb-3">
        <span className="text-sm text-primary font-medium">{currentPlayerName} wirft</span>
        {!doubleOut && mode !== "cricket" && <span className="text-[10px] text-muted-foreground ml-2">(Single Out)</span>}
        <div className="flex justify-center gap-1 mt-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`w-3 h-3 rounded-full transition-all ${i < dartsThisRound ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>
        <div className="flex items-center justify-center gap-2 mt-1">
          <span className="text-[10px] text-muted-foreground">Dart {dartsThisRound + 1} / 3</span>
          {dartsThisRound > 0 && (
            <span className="text-xs font-display text-primary">+{currentRoundTotal}</span>
          )}
        </div>
      </div>

      {/* Checkout suggestion */}
      {!isCricket && <div className="mb-3"><CheckoutSuggestion remaining={currentRemaining} playerName={currentPlayerName} /></div>}

      {/* Live Camera (auto-scoring) */}
      {cameraEnabled && (
        <LiveCamera
          enabled={cameraEnabled}
          onClose={() => setCameraEnabled(false)}
          onRoundCommit={submitDetectedRound}
        />
      )}

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
      <DartScoreInput selectedValue={selectedScore} selectedMultiplier={multiplier} isDisabled={game.isFinished}
        onValueSelect={setSelectedScore} onMultiplierSelect={setMultiplier} onSubmit={throwDart}
        onQuickRound={!isCricket ? handleQuickRound : undefined} />

      {/* Undo & actions row */}
      <div className="flex gap-2 mt-3">
        <Button variant="outline" onClick={undoLastDart} disabled={undoStack.length === 0} className="flex-1 gap-1">
          <Undo2 className="w-4 h-4" /> Rückgängig
        </Button>
        <Button
          variant={cameraEnabled ? "default" : "outline"}
          onClick={() => setCameraEnabled((v) => !v)}
          className="gap-1"
          title="Live-Kamera-Scoring"
        >
          <Camera className="w-4 h-4" /> {cameraEnabled ? "Cam an" : "Cam"}
        </Button>
        <Button variant="outline" onClick={() => setSoundEnabled(!soundEnabled)} className="gap-1">
          {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </Button>
      </div>

      {/* Throw history (editable) */}
      {currentThrows.length > 0 && (
        <div className="mt-3 bg-card rounded-xl border border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground uppercase font-display">Würfe · {currentPlayerName}</p>
            <button onClick={() => setEditingThrowIdx(editingThrowIdx !== null ? null : 0)} className="text-xs text-primary flex items-center gap-1">
              <Edit2 className="w-3 h-3" /> Bearbeiten
            </button>
          </div>
          {/* Show rounds (groups of 3) */}
          <div className="space-y-1">
            {Array.from({ length: Math.ceil(currentThrows.length / 3) }, (_, roundIdx) => {
              const roundThrows = currentThrows.slice(roundIdx * 3, roundIdx * 3 + 3);
              const roundTotal = roundThrows.reduce((s, t) => s + t.points, 0);
              const is180 = roundTotal === 180 && roundThrows.length === 3;
              return (
                <div key={roundIdx} className={`flex items-center gap-1.5 px-2 py-1 rounded ${is180 ? "bg-accent/10 border border-accent/30" : ""}`}>
                  <span className="text-[10px] text-muted-foreground w-4">{roundIdx + 1}.</span>
                  {roundThrows.map((t, i) => {
                    const globalIdx = roundIdx * 3 + i;
                    return (
                      <div key={globalIdx} className="relative group">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono ${
                          t.multiplier === 3 ? "bg-destructive/20 text-destructive" :
                          t.multiplier === 2 ? "bg-secondary/20 text-secondary" : "bg-muted text-foreground"
                        }`}>
                          {t.multiplier === 3 ? "T" : t.multiplier === 2 ? "D" : ""}{t.baseValue === 50 ? "Bull" : t.baseValue === 0 ? "Miss" : t.baseValue}
                        </span>
                        {editingThrowIdx !== null && (
                          <button onClick={() => deleteThrow(game.currentPlayerId, globalIdx)}
                            className="absolute -top-1 -right-1 w-4 h-4 bg-destructive rounded-full flex items-center justify-center">
                            <X className="w-2.5 h-2.5 text-destructive-foreground" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <span className={`text-xs font-display ml-auto ${is180 ? "text-accent" : "text-muted-foreground"}`}>
                    {roundThrows.length === 3 ? roundTotal : "..."}{is180 && " 🎯"}
                  </span>
                </div>
              );
            })}
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
