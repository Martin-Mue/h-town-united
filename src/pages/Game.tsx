import { useState, useMemo, useEffect, useRef } from "react";
import { RotateCcw, Trophy, Target, Edit2, X, Users, Undo2, Volume2, VolumeX, Camera, Mic, MicOff, Bot, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import DartScoreInput from "@/components/game/DartScoreInput";
import CheckoutSuggestion from "@/components/game/CheckoutSuggestion";
import LiveCamera, { type DetectedDart } from "@/components/game/LiveCamera";
import type { GameMode, GameState, LegState, DartThrow, CricketPlayerState, PlayerSlot, BotLevel } from "@/types/game";
import { CRICKET_NUMBERS } from "@/types/game";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { simulateBotVisit, simulateBotCricketDart } from "@/utils/botPlayer";

/** Bot personas with their target 3-dart average */
const BOT_PROFILES: Record<BotLevel, { name: string; average: string }> = {
  easy: { name: "Bot Lv.1 · Rookie", average: "25–30" },
  medium: { name: "Bot Lv.2 · Ligaspieler", average: "45–50" },
  hard: { name: "Bot Lv.3 · Pro", average: "68–75" },
};
import {
  playThrowSound, playBustSound, play180Sound, playCheckoutSound,
  playVictorySound, playTonPlusSound, playTurnSwitchSound,
} from "@/utils/sounds";
import { describeDartForSpeech, speakText } from "@/utils/speech";

const SPEECH_PREF_KEY = "dart-speech-enabled";
const MAX_PLAYERS = 4;

function createLegState(legNumber: number, startScore: number, startingPlayerIndex: number, numPlayers: number): LegState {
  return {
    legNumber,
    startingPlayerIndex,
    remaining: Array(numPlayers).fill(startScore),
    throws: Array.from({ length: numPlayers }, () => []),
  };
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
function getHighest3DartRound(throws: DartThrow[]): number {
  let max = 0;
  for (let i = 0; i < throws.length; i += 3) {
    const round = throws.slice(i, i + 3).reduce((s, t) => s + t.points, 0);
    if (round > max) max = round;
  }
  return max;
}
function getFirst9Average(throws: DartThrow[]): number {
  const first9 = throws.slice(0, 9);
  if (first9.length === 0) return 0;
  return (first9.reduce((s, t) => s + t.points, 0) / first9.length) * 3;
}
function countTonPlusRounds(throws: DartThrow[]): number {
  let count = 0;
  for (let i = 0; i < throws.length; i += 3) {
    const round = throws.slice(i, i + 3).reduce((s, t) => s + t.points, 0);
    if (round >= 100) count++;
  }
  return count;
}
function count180s(throws: DartThrow[]): number {
  let count = 0;
  for (let i = 0; i < throws.length; i += 3) {
    const round = throws.slice(i, i + 3).reduce((s, t) => s + t.points, 0);
    if (round === 180) count++;
  }
  return count;
}
function dartLabel(t: DartThrow): string {
  return t.baseValue === 0 ? "M" : t.baseValue === 25 ? (t.multiplier === 2 ? "BULL" : "25") : `${t.multiplier === 2 ? "D" : t.multiplier === 3 ? "T" : ""}${t.baseValue}`;
}

interface DbPlayer { id: string; name: string; emoji: string; }

/** Undo snapshot for reverting last dart */
interface UndoSnapshot {
  game: GameState;
  dartsThisRound: number;
  turnStartRemaining: number;
}

const DEFAULT_NAMES = ["Spieler 1", "Spieler 2", "Spieler 3", "Spieler 4"];

const GamePage = () => {
  const [phase, setPhase] = useState<"setup" | "playing" | "postGame">("setup");
  const [mode, setMode] = useState<GameMode>("501");
  const [bestOfLegs, setBestOfLegs] = useState(1);
  const [maxRoundsX01, setMaxRoundsX01] = useState<number>(0); // 0 = unlimited
  const [customStartScore, setCustomStartScore] = useState(501);
  const [numPlayers, setNumPlayers] = useState(2);
  const [playerNames, setPlayerNames] = useState<string[]>([...DEFAULT_NAMES]);
  const [playerDoubleOut, setPlayerDoubleOut] = useState<boolean[]>([true, true, true, true]);
  const [playerIsBot, setPlayerIsBot] = useState<boolean[]>([false, false, false, false]);
  const [playerBotLevel, setPlayerBotLevel] = useState<BotLevel[]>(["medium", "medium", "medium", "medium"]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [speechEnabled, setSpeechEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(SPEECH_PREF_KEY);
    return raw ? raw !== "false" : true;
  });
  const [game, setGame] = useState<GameState | null>(null);
  const [selectedScore, setSelectedScore] = useState(20);
  const [multiplier, setMultiplier] = useState(1);
  const [editingThrowIdx, setEditingThrowIdx] = useState<number | null>(null);
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [gameSaved, setGameSaved] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const savingRef = useRef(false);
  const [dbPlayers, setDbPlayers] = useState<DbPlayer[]>([]);
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [pendingCameraDarts, setPendingCameraDarts] = useState<DetectedDart[]>([]);
  const [botThinking, setBotThinking] = useState(false);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const botPlanRef = useRef<{ key: string; darts: DartThrow[]; applied: number } | null>(null);

  useEffect(() => {
    supabase.from("players").select("id, name, emoji").order("name").then(({ data }) => {
      if (data) setDbPlayers(data);
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SPEECH_PREF_KEY, JSON.stringify(speechEnabled));
  }, [speechEnabled]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (botTimerRef.current) clearTimeout(botTimerRef.current);
    };
  }, []);

  const [dartsThisRound, setDartsThisRound] = useState(0);
  const [turnStartRemaining, setTurnStartRemaining] = useState<number>(0);

  const isCricket = game?.mode === "cricket";
  const currentIdx = game?.currentPlayerIndex ?? 0;
  const currentPlayer: PlayerSlot | undefined = game?.players[currentIdx];

  /** 3-dart round scores for display during game */
  const currentRoundScores = useMemo(() => {
    if (!game) return [];
    const throws = game.currentLeg.throws[currentIdx] ?? [];
    return throws.slice(-dartsThisRound);
  }, [game, dartsThisRound, currentIdx]);

  const currentRoundTotal = currentRoundScores.reduce((s, t) => s + t.points, 0);

  const getStartScore = (): number => {
    if (mode === "cricket") return 0;
    if (mode === "custom") return customStartScore;
    return parseInt(mode);
  };

  const startGame = () => {
    const startScore = getStartScore();
    const n = mode === "cricket" ? 2 : numPlayers;
    const players: PlayerSlot[] = Array.from({ length: n }, (_, i) => ({
      name: playerIsBot[i]
        ? BOT_PROFILES[playerBotLevel[i] ?? "medium"].name
        : (playerNames[i]?.trim() || `Spieler ${i + 1}`),
      doubleOut: playerDoubleOut[i] ?? true,
      isBot: mode === "cricket" ? playerIsBot[i] : playerIsBot[i],
      botLevel: playerBotLevel[i] ?? "medium",
    }));
    const newGame: GameState = {
      mode, startScore, bestOfLegs, players,
      legsWon: Array(n).fill(0),
      currentLeg: createLegState(1, startScore, 0, n), completedLegs: [],
      currentPlayerIndex: 0, isFinished: false,
      maxRoundsX01: mode !== "cricket" && maxRoundsX01 > 0 ? maxRoundsX01 : undefined,
    };
    if (mode === "cricket") {
      newGame.cricket = [createCricketState(), createCricketState()];
    }
    setGame(newGame);
    setPhase("playing");
    setDartsThisRound(0);
    setTurnStartRemaining(startScore);
    setUndoStack([]);
    botPlanRef.current = null;
  };

  /** Save undo snapshot before each throw */
  const saveUndo = () => {
    if (!game) return;
    setUndoStack(prev => [...prev, { game: JSON.parse(JSON.stringify(game)), dartsThisRound, turnStartRemaining }]);
  };

  /** Undo the last dart throw */
  const undoLastDart = () => {
    if (undoStack.length === 0) return;
    if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }
    botPlanRef.current = null;
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
    const idx = game.currentPlayerIndex;
    const n = game.players.length;
    const remaining = game.currentLeg.remaining[idx];
    const newRemaining = remaining - points;
    const newDartsThisRound = dartsThisRound + 1;

    const activeDoubleOut = game.players[idx].doubleOut ?? true;
    const isBust = newRemaining < 0 || newRemaining === 1 ||
      (newRemaining === 0 && activeDoubleOut && mul !== 2 && !(baseValue === 25 && mul === 2));

    if (isBust) {
      if (soundEnabled) playBustSound();
      setGame((prev) => {
        if (!prev) return prev;
        const updatedLeg: LegState = { ...prev.currentLeg, remaining: [...prev.currentLeg.remaining], throws: prev.currentLeg.throws.map(t => [...t]) };
        updatedLeg.remaining[idx] = turnStartRemaining;
        updatedLeg.throws[idx] = updatedLeg.throws[idx].slice(0, updatedLeg.throws[idx].length - (newDartsThisRound - 1));
        const nextIdx = (idx + 1) % n;
        return { ...prev, currentLeg: updatedLeg, currentPlayerIndex: nextIdx };
      });
      setDartsThisRound(0);
      setTurnStartRemaining(game.currentLeg.remaining[(idx + 1) % n]);
      if (soundEnabled) setTimeout(() => playTurnSwitchSound(), 300);
      return;
    }

    if (soundEnabled) playThrowSound();

    setGame((prev) => {
      if (!prev) return prev;
      const updatedLeg: LegState = { ...prev.currentLeg, remaining: [...prev.currentLeg.remaining], throws: prev.currentLeg.throws.map(t => [...t]) };
      updatedLeg.remaining[idx] = newRemaining;
      updatedLeg.throws[idx] = [...updatedLeg.throws[idx], dart];

      // Checkout
      if (newRemaining === 0) {
        updatedLeg.winnerIndex = idx;
        const legsWon = [...prev.legsWon];
        legsWon[idx] += 1;
        const legsToWin = Math.ceil(prev.bestOfLegs / 2);
        const updated: GameState = { ...prev, currentLeg: updatedLeg, legsWon };

        if (legsWon[idx] >= legsToWin) {
          updated.isFinished = true;
          updated.winnerName = prev.players[idx].name;
          updated.winnerIndex = idx;
        } else {
          updated.completedLegs = [...prev.completedLegs, updatedLeg];
          const nextStarter = (updatedLeg.startingPlayerIndex + 1) % n;
          updated.currentLeg = createLegState(updatedLeg.legNumber + 1, prev.startScore, nextStarter, n);
          updated.currentPlayerIndex = nextStarter;
        }
        return updated;
      }

      // After 3 darts → switch
      if (newDartsThisRound >= 3) {
        const nextIdx = (idx + 1) % n;
        const next: GameState = { ...prev, currentLeg: updatedLeg, currentPlayerIndex: nextIdx };
        const cap = prev.maxRoundsX01;
        if (cap && cap > 0) {
          const rounds = updatedLeg.throws.map(t => Math.ceil(t.length / 3));
          if (rounds.every(r => r >= cap)) {
            const minRemaining = Math.min(...updatedLeg.remaining);
            const winners = updatedLeg.remaining.reduce<number[]>((acc, r, i) => (r === minRemaining ? [...acc, i] : acc), []);
            if (winners.length === 1) {
              const legWinner = winners[0];
              updatedLeg.winnerIndex = legWinner;
              const legsWon = [...prev.legsWon];
              legsWon[legWinner] += 1;
              const legsToWin = Math.ceil(prev.bestOfLegs / 2);
              const finished = legsWon[legWinner] >= legsToWin;
              if (finished) {
                return { ...next, currentLeg: updatedLeg, legsWon, isFinished: true, winnerName: prev.players[legWinner].name, winnerIndex: legWinner };
              }
              const nextStarter = (legWinner + 1) % n;
              return { ...next, completedLegs: [...prev.completedLegs, updatedLeg], legsWon, currentLeg: createLegState(updatedLeg.legNumber + 1, prev.startScore, nextStarter, n), currentPlayerIndex: nextStarter };
            }
          }
        }
        return next;
      }

      return { ...prev, currentLeg: updatedLeg };
    });

    if (newRemaining === 0) {
      setDartsThisRound(0);
      setTurnStartRemaining(game.startScore);
      const legsWon = game.legsWon[idx] + 1;
      const legsToWin = Math.ceil(game.bestOfLegs / 2);
      if (soundEnabled) {
        if (legsWon >= legsToWin) {
          setTimeout(() => playVictorySound(), 200);
        } else {
          setTimeout(() => playCheckoutSound(), 100);
        }
      }
    } else if (newDartsThisRound >= 3) {
      const roundThrows = game.currentLeg.throws[idx].slice(-2);
      const roundTotal = roundThrows.reduce((s, t) => s + t.points, 0) + points;
      if (soundEnabled) {
        if (roundTotal === 180) setTimeout(() => play180Sound(), 100);
        else if (roundTotal >= 100) setTimeout(() => playTonPlusSound(), 100);
        else setTimeout(() => playTurnSwitchSound(), 100);
      }
      setDartsThisRound(0);
      setTurnStartRemaining(game.currentLeg.remaining[(idx + 1) % game.players.length]);
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
      const idx = prev.currentPlayerIndex;
      const oppIdx = idx === 0 ? 1 : 0;
      const cricket = prev.cricket!.map(c => ({ ...c, marks: { ...c.marks } }));
      const myState = cricket[idx];
      const oppState = cricket[oppIdx];

      if ((CRICKET_NUMBERS as readonly number[]).includes(targetNumber) && targetNumber !== 0) {
        const hitsToAdd = baseValue === 50 ? 2 : mul;
        const currentMarks = myState.marks[targetNumber] || 0;
        const newMarks = currentMarks + hitsToAdd;
        myState.marks[targetNumber] = newMarks;
        if (newMarks > 3 && (oppState.marks[targetNumber] || 0) < 3) {
          const scorableHits = newMarks - Math.max(currentMarks, 3);
          myState.points += targetNumber * scorableHits;
        }
      }

      const updatedLeg: LegState = { ...prev.currentLeg, throws: prev.currentLeg.throws.map(t => [...t]) };
      updatedLeg.throws[idx] = [...updatedLeg.throws[idx], dart];

      const updated: GameState = { ...prev, currentLeg: updatedLeg, cricket };

      const allClosed = CRICKET_NUMBERS.every((n) => (myState.marks[n] || 0) >= 3);
      if (allClosed && myState.points >= oppState.points) {
        updatedLeg.winnerIndex = idx;
        updated.isFinished = true;
        updated.winnerName = prev.players[idx].name;
        updated.winnerIndex = idx;
      } else if (newDartsThisRound >= 3) {
        updated.currentPlayerIndex = oppIdx;
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
   */
  const submitDetectedRound = (darts: DetectedDart[]) => {
    if (!game || game.isFinished || darts.length === 0) return;
    if (currentPlayer?.isBot) return; // bots never use the camera

    setUndoStack(prev => [...prev, {
      game: JSON.parse(JSON.stringify(game)),
      dartsThisRound,
      turnStartRemaining,
    }]);

    const curGame: GameState = JSON.parse(JSON.stringify(game));
    let curDarts = dartsThisRound;
    let curStart = turnStartRemaining;
    let busted = false;
    let checkedOut = false;
    let roundTotal = 0;
    const n = curGame.players.length;

    const dartsToApply = darts.slice(0, 3);
    const startIdx = curGame.currentPlayerIndex;

    for (const d of dartsToApply) {
      if (curGame.isFinished) break;
      const idx = curGame.currentPlayerIndex;
      const points = d.baseValue === 25 && d.multiplier === 3 ? 0 : d.baseValue * d.multiplier;
      const dart: DartThrow = { baseValue: d.baseValue, multiplier: d.multiplier, points };

      if (curGame.mode === "cricket") {
        const oppIdx = idx === 0 ? 1 : 0;
        const myState = curGame.cricket![idx];
        const oppState = curGame.cricket![oppIdx];
        const targetNumber = d.baseValue === 50 ? 25 : d.baseValue;
        if ((CRICKET_NUMBERS as readonly number[]).includes(targetNumber) && targetNumber !== 0) {
          const hitsToAdd = d.baseValue === 50 ? 2 : d.multiplier;
          const currentMarks = myState.marks[targetNumber] || 0;
          const newMarks = currentMarks + hitsToAdd;
          myState.marks = { ...myState.marks, [targetNumber]: newMarks };
          if (newMarks > 3 && (oppState.marks[targetNumber] || 0) < 3) {
            const scorableHits = newMarks - Math.max(currentMarks, 3);
            myState.points += targetNumber * scorableHits;
          }
        }
        curGame.currentLeg.throws[idx] = [...curGame.currentLeg.throws[idx], dart];
        const allClosed = CRICKET_NUMBERS.every((num) => (myState.marks[num] || 0) >= 3);
        if (allClosed && myState.points >= oppState.points) {
          curGame.currentLeg.winnerIndex = idx;
          curGame.isFinished = true;
          curGame.winnerName = curGame.players[idx].name;
          curGame.winnerIndex = idx;
          checkedOut = true;
        }
        curDarts += 1;
        continue;
      }

      // X01 modes
      const remaining = curGame.currentLeg.remaining[idx];
      const newRemaining = remaining - points;
      const newDartsThisRound = curDarts + 1;
      const mul: number = d.multiplier;
      const isDoubleOut = mul === 2;
      const activeDoubleOut = curGame.players[idx].doubleOut ?? true;
      const isBust = newRemaining < 0 || newRemaining === 1 ||
        (newRemaining === 0 && activeDoubleOut && !isDoubleOut);

      if (isBust) {
        curGame.currentLeg.remaining[idx] = curStart;
        curGame.currentLeg.throws[idx] = curGame.currentLeg.throws[idx].slice(
          0, curGame.currentLeg.throws[idx].length - (newDartsThisRound - 1)
        );
        busted = true;
        break;
      }

      curGame.currentLeg.remaining[idx] = newRemaining;
      curGame.currentLeg.throws[idx] = [...curGame.currentLeg.throws[idx], dart];
      curDarts = newDartsThisRound;
      roundTotal += points;

      if (newRemaining === 0) {
        curGame.currentLeg.winnerIndex = idx;
        curGame.legsWon[idx] += 1;
        const legsToWin = Math.ceil(curGame.bestOfLegs / 2);
        if (curGame.legsWon[idx] >= legsToWin) {
          curGame.isFinished = true;
          curGame.winnerName = curGame.players[idx].name;
          curGame.winnerIndex = idx;
        } else {
          curGame.completedLegs = [...curGame.completedLegs, curGame.currentLeg];
          const nextStarter = (curGame.currentLeg.startingPlayerIndex + 1) % n;
          curGame.currentLeg = createLegState(curGame.currentLeg.legNumber + 1, curGame.startScore, nextStarter, n);
          curGame.currentPlayerIndex = nextStarter;
        }
        checkedOut = true;
        break;
      }
    }

    if (!curGame.isFinished) {
      if (busted || curDarts >= 1) {
        const idx = curGame.currentPlayerIndex;
        const nextIdx = (idx + 1) % n;
        curGame.currentPlayerIndex = nextIdx;
        curStart = curGame.currentLeg.remaining[nextIdx];
        curDarts = 0;
      }
    } else {
      curDarts = 0;
    }

    setGame(curGame);
    setDartsThisRound(curDarts);
    setTurnStartRemaining(curStart);
    setPendingCameraDarts([]);

    if (speechEnabled) {
      const activePlayerName = game.players[startIdx].name;
      const nextPlayerName = curGame.players[curGame.currentPlayerIndex].name;
      const remaining = curGame.mode === "cricket" ? undefined : game.currentLeg.remaining[startIdx];
      const dartText = darts.map(describeDartForSpeech).join(", ");
      const announcement = curGame.isFinished
        ? `Erkannt: ${dartText}. ${curGame.winnerName} gewinnt.`
        : checkedOut
          ? `Erkannt: ${dartText}. Leg gewonnen. ${nextPlayerName} startet das naechste Leg.`
          : busted
            ? `Erkannt: ${dartText}. Bust. ${nextPlayerName} ist dran.`
            : curGame.mode === "cricket"
              ? `Erkannt: ${dartText}. Runde uebernommen. ${nextPlayerName} ist dran.`
              : `Erkannt: ${dartText}. ${activePlayerName} hat ${roundTotal} Punkte geworfen. Verbleibend ${remaining}. ${nextPlayerName} ist dran.`;
      window.setTimeout(() => speakText(announcement), 160);
    }

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

  const deleteThrow = (playerIdx: number, throwIndex: number) => {
    setGame((prev) => {
      if (!prev) return prev;
      const throws = [...prev.currentLeg.throws[playerIdx]];
      const removed = throws.splice(throwIndex, 1)[0];
      const updatedLeg: LegState = { ...prev.currentLeg, throws: [...prev.currentLeg.throws], remaining: [...prev.currentLeg.remaining] };
      updatedLeg.throws[playerIdx] = throws;
      updatedLeg.remaining[playerIdx] += removed.points;
      return { ...prev, currentLeg: updatedLeg };
    });
    setEditingThrowIdx(null);
  };

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
    if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }
    botPlanRef.current = null;
    setPhase("setup"); setGame(null); setGameSaved(false); setShowDetailedStats(false);
    setDartsThisRound(0); setUndoStack([]);
  };

  // ─── BOT AUTO-PLAY ─────────────────────────────────
  useEffect(() => {
    if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }
    if (!game || game.isFinished || phase !== "playing") { setBotThinking(false); return; }
    const idx = game.currentPlayerIndex;
    const player = game.players[idx];
    if (!player?.isBot) { setBotThinking(false); return; }
    if (cameraEnabled) setCameraEnabled(false); // bots never trigger the camera

    setBotThinking(true);
    const level = player.botLevel ?? "medium";

    botTimerRef.current = setTimeout(() => {
      if (game.mode === "cricket") {
        const oppIdx = idx === 0 ? 1 : 0;
        const dart = simulateBotCricketDart(game.cricket![idx].marks, game.cricket![oppIdx].marks, level, CRICKET_NUMBERS);
        handleCricketThrow(dart.baseValue, dart.multiplier as 1 | 2 | 3);
      } else {
        const key = `${idx}-${game.currentLeg.legNumber}-${dartsThisRound}`;
        let plan = botPlanRef.current;
        if (!plan || plan.key.split("-")[0] !== String(idx) || plan.key.split("-")[1] !== String(game.currentLeg.legNumber) || dartsThisRound === 0) {
          const visit = simulateBotVisit(game.currentLeg.remaining[idx], player.doubleOut ?? true, level);
          plan = { key: `${idx}-${game.currentLeg.legNumber}`, darts: visit.darts, applied: 0 };
          botPlanRef.current = plan;
        }
        const dart = plan.darts[plan.applied];
        plan.applied += 1;
        if (dart) handleX01Throw(dart.baseValue, dart.multiplier as 1 | 2 | 3);
      }
    }, 1200);

    return () => {
      if (botTimerRef.current) clearTimeout(botTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.currentPlayerIndex, game?.currentLeg.legNumber, dartsThisRound, game?.isFinished, phase]);

  const saveGame = async () => {
    if (!game || !game.isFinished || savingRef.current || gameSaved) return;
    savingRef.current = true;
    const allLegs = [...game.completedLegs, game.currentLeg];
    const n = game.players.length;
    const throwsByPlayer = Array.from({ length: n }, (_, i) => allLegs.flatMap(l => l.throws[i] ?? []));
    const averages = throwsByPlayer.map(calculateAverage);
    const highs = throwsByPlayer.map(getHighest3DartRound);

    // Rank players by legs won (desc) to determine the top-2 finishers for the legacy DB schema.
    const ranking = game.players.map((_, i) => i).sort((a, b) => game.legsWon[b] - game.legsWon[a]);
    const [top1, top2] = ranking;

    const { data: allDbPlayers } = await supabase.from("players").select("id, name");
    const p1Match = allDbPlayers?.find(p => p.name === game.players[top1].name);
    const p2Match = top2 !== undefined ? allDbPlayers?.find(p => p.name === game.players[top2].name) : undefined;
    const winnerIdx = game.winnerIndex ?? top1;
    const winnerMatch = winnerIdx === top1 ? p1Match : p2Match;

    // Detailed per-player stats: treble-less visits + hits on the big triples
    const detailFor = (idx?: number) => {
      if (idx === undefined) return null;
      const throws = throwsByPlayer[idx];
      const visits: typeof throws[] = [];
      for (let i = 0; i < throws.length; i += 3) visits.push(throws.slice(i, i + 3));
      const trebleless = visits.filter(v => v.length > 0 && v.every(t => t.multiplier !== 3)).length;
      const tripleHits: Record<string, number> = {};
      [20, 19, 18, 17, 16].forEach(n => {
        tripleHits[`t${n}`] = throws.filter(t => t.multiplier === 3 && t.baseValue === n).length;
      });
      return {
        name: game.players[idx].name,
        visits: visits.length,
        trebleless,
        treblelessRate: visits.length ? Math.round((trebleless / visits.length) * 1000) / 10 : 0,
        triples: throws.filter(t => t.multiplier === 3).length,
        ...tripleHits,
      };
    };

    await supabase.from("games").insert({
      user_id: session?.user?.id, mode: game.mode, start_score: game.startScore,
      best_of_legs: game.bestOfLegs,
      player1_name: game.players[top1].name, player2_name: top2 !== undefined ? game.players[top2].name : "—",
      player1_id: p1Match?.id || null, player2_id: p2Match?.id || null,
      player1_legs_won: game.legsWon[top1], player2_legs_won: top2 !== undefined ? game.legsWon[top2] : 0,
      player1_average: averages[top1], player2_average: top2 !== undefined ? averages[top2] : 0,
      player1_highscore: highs[top1], player2_highscore: top2 !== undefined ? highs[top2] : 0,
      player1_total_throws: throwsByPlayer[top1].length, player2_total_throws: top2 !== undefined ? throwsByPlayer[top2].length : 0,
      winner_name: game.winnerName!, winner_id: winnerMatch?.id || null,
      detail_stats: { player1: detailFor(top1), player2: detailFor(top2) } as any,
    });

    for (const i of [top1, top2].filter((v): v is number => v !== undefined)) {
      const match = allDbPlayers?.find(p => p.name === game.players[i].name);
      if (match && !game.players[i].isBot) {
        const { data: current } = await supabase.from("players").select("*").eq("id", match.id).single();
        if (current) {
          const gp = current.games_played + 1;
          const newAvg = (Number(current.average) * current.games_played + averages[i]) / gp;
          await supabase.from("players").update({
            games_played: gp, games_won: current.games_won + (game.winnerIndex === i ? 1 : 0),
            average: Math.round(newAvg * 10) / 10, high_score: Math.max(current.high_score, highs[i]),
          }).eq("id", match.id);
        }
      }
    }
    if (n > 2) {
      toast({ title: "Spiel gespeichert", description: "Bei mehr als 2 Spielern werden nur die Top 2 in der Statistik-Datenbank erfasst." });
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
    return game.players.map((p, i) => {
      const throws = allLegs.flatMap(l => l.throws[i] ?? []);
      return {
        name: p.name,
        average: calculateAverage(throws),
        highscore: getHighest3DartRound(throws),
        totalThrows: throws.length,
        doubles: throws.filter(t => t.multiplier === 2).length,
        triples: throws.filter(t => t.multiplier === 3).length,
        tonPlus: countTonPlusRounds(throws),
        s180: count180s(throws),
        first9: getFirst9Average(throws),
        totalPoints: throws.reduce((s, t) => s + t.points, 0),
        legs: game.legsWon[i],
      };
    });
  }, [game?.isFinished]);

  // ─── SETUP PHASE ───────────────────────────────
  if (phase === "setup") {
    const activePlayerCount = mode === "cricket" ? 2 : numPlayers;
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
                <label className="text-sm text-muted-foreground mb-1 block">Anzahl Spieler</label>
                <div className="grid grid-cols-3 gap-2">
                  {[2, 3, 4].map((n) => (
                    <button key={n} onClick={() => setNumPlayers(n)}
                      className={`rounded-lg border px-3 py-2 text-sm font-display transition-colors ${numPlayers === n ? "bg-primary/15 border-primary text-primary" : "bg-card border-border text-muted-foreground"}`}>
                      {n} Spieler
                    </button>
                  ))}
                </div>
              </div>

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

              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Rundenlimit pro Leg</label>
                <Select value={String(maxRoundsX01)} onValueChange={(v) => setMaxRoundsX01(parseInt(v))}>
                  <SelectTrigger className="bg-card border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="0">Kein Limit</SelectItem>
                    {[8, 10, 12, 15, 20, 25].map((n) => (
                      <SelectItem key={n} value={String(n)}>Max. {n} Runden</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">Nach dem Limit gewinnt das Leg wer weniger Restpunkte hat.</p>
              </div>
            </>
          )}

          {/* Player slots: name, double-out, bot toggle */}
          <div className="space-y-3">
            {Array.from({ length: activePlayerCount }, (_, i) => (
              <div key={i} className="bg-card rounded-lg border border-border px-4 py-3 space-y-2">
                <div className="flex items-center gap-2">
                  {playerIsBot[i] ? (
                    <div className="flex-1 rounded-lg bg-secondary/10 border border-secondary/40 px-3 py-2 text-sm text-secondary flex items-center gap-2 min-w-0">
                      <Bot className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{BOT_PROFILES[playerBotLevel[i]].name}</span>
                    </div>
                  ) : (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="flex-1 rounded-lg bg-background border border-border px-3 py-2 text-sm text-foreground text-left flex items-center justify-between min-w-0">
                        <span className="truncate">{playerNames[i]}</span>
                        <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-2" align="start">
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {dbPlayers.map((dp) => (
                          <button key={dp.id} onClick={() => setPlayerNames(prev => prev.map((v, idx) => idx === i ? dp.name : v))}
                            className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${playerNames[i] === dp.name ? "bg-primary/15 text-primary" : "hover:bg-muted"}`}>
                            <span>{dp.emoji}</span><span>{dp.name}</span>
                          </button>
                        ))}
                      </div>
                      <div className="border-t border-border mt-2 pt-2">
                        <input value={playerNames[i]} onChange={(e) => setPlayerNames(prev => prev.map((v, idx) => idx === i ? e.target.value : v))} placeholder="Oder Name eingeben..."
                          className="w-full rounded bg-muted border-0 px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                      </div>
                    </PopoverContent>
                  </Popover>
                  )}
                  <button
                    onClick={() => setPlayerIsBot(prev => prev.map((v, idx) => idx === i ? !v : v))}
                    className={`shrink-0 rounded-lg border px-2.5 py-2 flex items-center gap-1 text-xs transition-colors ${playerIsBot[i] ? "bg-secondary/20 border-secondary text-secondary" : "bg-background border-border text-muted-foreground"}`}
                    title="Bot-Gegner">
                    <Bot className="w-3.5 h-3.5" /> Bot
                  </button>
                </div>

                {playerIsBot[i] && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["easy", "medium", "hard"] as BotLevel[]).map((lvl) => (
                      <button key={lvl} onClick={() => setPlayerBotLevel(prev => prev.map((v, idx) => idx === i ? lvl : v))}
                        className={`rounded px-2 py-1.5 text-center transition-colors ${playerBotLevel[i] === lvl ? "bg-secondary/25 text-secondary" : "bg-background text-muted-foreground"}`}>
                        <span className="block text-[11px] font-display uppercase">{BOT_PROFILES[lvl].name}</span>
                        <span className="block text-[10px] opacity-70">Ø {BOT_PROFILES[lvl].average}</span>
                      </button>
                    ))}
                  </div>
                )}

                {mode !== "cricket" && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{playerDoubleOut[i] ? "Double Out" : "Single Out"}</span>
                    <Switch checked={playerDoubleOut[i]} onCheckedChange={(v) => setPlayerDoubleOut(prev => prev.map((val, idx) => idx === i ? v : val))} />
                  </div>
                )}
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

          <div className="flex items-center justify-between bg-card rounded-lg border border-border px-4 py-3">
            <div className="flex items-center gap-2">
              {speechEnabled ? <Mic className="w-4 h-4 text-primary" /> : <MicOff className="w-4 h-4 text-muted-foreground" />}
              <Label className="text-sm font-medium">Sprachausgabe</Label>
            </div>
            <Switch checked={speechEnabled} onCheckedChange={setSpeechEnabled} />
          </div>

          <Button onClick={startGame} className="w-full mt-4 font-display uppercase text-lg py-6">
            <Target className="w-5 h-5 mr-2" /> Spiel starten
          </Button>
        </div>
      </div>
    );
  }

  if (!game) return null;

  const activeIdx = game.currentPlayerIndex;
  const currentPlayerName = game.players[activeIdx].name;
  const currentRemaining = game.currentLeg.remaining[activeIdx];
  const currentThrows = game.currentLeg.throws[activeIdx];
  const numCols = game.players.length <= 2 ? "grid-cols-2" : game.players.length === 3 ? "grid-cols-3" : "grid-cols-2 md:grid-cols-4";

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
            {game.bestOfLegs > 1 && <p className="text-sm text-muted-foreground mb-4">{game.legsWon.join(" : ")} Legs</p>}

            {postGameStats && (
              <div className="grid grid-cols-2 gap-3 mb-4 text-left">
                {postGameStats.map((p) => (
                  <div key={p.name} className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
                    <p className="font-semibold text-sm truncate">{p.name}</p>
                    <p className="text-muted-foreground">Ø <span className="text-foreground font-bold">{p.average.toFixed(1)}</span></p>
                    <p className="text-muted-foreground">High <span className="text-foreground font-bold">{p.highscore}</span></p>
                    <p className="text-muted-foreground">First 9 <span className="text-foreground font-bold">{p.first9.toFixed(1)}</span></p>
                    {p.s180 > 0 && <p className="text-accent font-bold">🎯 {p.s180}× 180!</p>}
                    {p.tonPlus > 0 && <p className="text-muted-foreground">100+ <span className="text-foreground font-bold">{p.tonPlus}×</span></p>}
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
              <div className="bg-muted/30 rounded-lg p-4 mb-4 text-xs overflow-x-auto">
                <div className="grid gap-y-2" style={{ gridTemplateColumns: `1fr repeat(${postGameStats.length}, 1fr)` }}>
                  <span className="text-muted-foreground text-left">Statistik</span>
                  {postGameStats.map(p => <span key={p.name} className="font-semibold text-primary text-center truncate">{p.name}</span>)}

                  {[
                    { l: "Ø Average", v: (p: typeof postGameStats[number]) => p.average.toFixed(1) },
                    { l: "First 9 Ø", v: (p: typeof postGameStats[number]) => p.first9.toFixed(1) },
                    { l: "Highscore", v: (p: typeof postGameStats[number]) => p.highscore },
                    { l: "Würfe", v: (p: typeof postGameStats[number]) => p.totalThrows },
                    { l: "Doubles", v: (p: typeof postGameStats[number]) => p.doubles },
                    { l: "Triples", v: (p: typeof postGameStats[number]) => p.triples },
                    { l: "100+", v: (p: typeof postGameStats[number]) => p.tonPlus },
                    { l: "180!", v: (p: typeof postGameStats[number]) => p.s180 },
                    { l: "Punkte", v: (p: typeof postGameStats[number]) => p.totalPoints },
                  ].map(row => (
                    <span key={row.l} className="contents">
                      <span className="text-left text-muted-foreground">{row.l}</span>
                      {postGameStats.map(p => <span key={p.name} className="text-center font-display">{row.v(p)}</span>)}
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

      {/* Scoreboard (sticky so it stays visible when the camera is open) */}
      <div className="sticky top-0 z-30 -mx-4 px-4 pt-3 pb-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/40">
      <div className={`grid ${numCols} gap-3`}>
        {game.players.map((slot, i) => {
          const throws = game.currentLeg.throws[i];
          const remaining = game.currentLeg.remaining[i];
          const cricket = game.cricket?.[i];
          const avg = calculateAverage(throws);
          const p180 = count180s(throws);
          const isActive = activeIdx === i;
          const activeRound = isActive ? currentRoundScores : [];
          const pendingTotal = isActive && cameraEnabled
            ? pendingCameraDarts.reduce((s, d) => s + d.points, 0)
            : 0;
          const previewRemaining = !isCricket && pendingTotal > 0
            ? Math.max(0, remaining - pendingTotal)
            : remaining;
          const showPreview = pendingTotal > 0 && !isCricket;
          return (
            <div key={i}
              className={`bg-card rounded-xl p-4 border-2 transition-all text-center ${isActive ? "border-primary glow-cyan" : "border-border opacity-80"}`}>
              <div className="flex items-center justify-center gap-1.5">
                {isActive && <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse-glow" />}
                {slot.isBot && <Bot className="w-3 h-3 text-secondary shrink-0" />}
                <p className={`text-sm truncate ${isActive ? "text-primary font-semibold" : "text-muted-foreground"}`}>{slot.name}</p>
              </div>
              {isActive && slot.isBot && botThinking ? (
                <p className="text-sm font-display mt-1 text-secondary animate-pulse">Bot wirft…</p>
              ) : (
                <p className={`text-4xl font-display mt-1 transition-colors ${
                  showPreview ? "text-accent" : isActive ? "text-foreground" : "text-muted-foreground"
                }`}>
                  {isCricket ? cricket?.points ?? 0 : previewRemaining}
                </p>
              )}
              {showPreview && (
                <p className="text-[10px] text-muted-foreground -mt-1">
                  ({remaining} − {pendingTotal} live)
                </p>
              )}
              {isActive && cameraEnabled && pendingCameraDarts.length > 0 && (
                <div className="mt-1 flex items-center justify-center gap-1 flex-wrap">
                  {pendingCameraDarts.map((t, idx) => (
                    <span key={idx} className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-display text-accent ring-1 ring-accent/40">
                      {dartLabel(t)}
                    </span>
                  ))}
                </div>
              )}
              {isActive && activeRound.length > 0 && (
                <div className="mt-1 flex items-center justify-center gap-1 flex-wrap">
                  {activeRound.map((t, idx) => (
                    <span key={idx} className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-display text-primary">
                      {dartLabel(t)}
                    </span>
                  ))}
                  <span className="ml-1 text-[10px] font-display text-accent">+{currentRoundTotal}</span>
                </div>
              )}
              <div className="flex justify-center flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                <span>Ø {avg.toFixed(1)}</span>
                {game.bestOfLegs > 1 && <span className="text-primary font-bold">{game.legsWon[i]} Legs</span>}
                {p180 > 0 && <span className="text-accent font-bold">🎯{p180}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Leg info bar */}
      {game.bestOfLegs > 1 && (
        <div className="text-center text-xs text-muted-foreground mt-2">
          Leg {game.currentLeg.legNumber} · {game.players[game.currentLeg.startingPlayerIndex].name} fängt an
        </div>
      )}

      {/* Current player indicator with dart counter + round score */}
      <div className="text-center mt-2">
        <span className="text-sm text-primary font-medium">
          {currentPlayer?.isBot && botThinking ? `${currentPlayerName} (Bot) wirft…` : `${currentPlayerName} wirft`}
        </span>
        {mode !== "cricket" && !(currentPlayer?.doubleOut ?? true) && (
          <span className="text-[10px] text-muted-foreground ml-2">(Single Out)</span>
        )}
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
      </div>

      {/* Checkout suggestion */}
      {!isCricket && !currentPlayer?.isBot && <div className="mt-3 mb-3"><CheckoutSuggestion remaining={currentRemaining} playerName={currentPlayerName} /></div>}

      {/* Live Camera (auto-scoring) — never shown for bot turns */}
      {cameraEnabled && !currentPlayer?.isBot && (
        <LiveCamera
          enabled={cameraEnabled}
          onClose={() => { setCameraEnabled(false); setPendingCameraDarts([]); }}
          onRoundCommit={submitDetectedRound}
          onPendingChange={setPendingCameraDarts}
          dartsRemaining={Math.max(1, 3 - dartsThisRound)}
          playerName={currentPlayerName}
        />
      )}

      {/* Cricket scoreboard */}
      {isCricket && game.cricket && (
        <div className="bg-card rounded-xl border border-border p-3 mb-3">
          <div className="grid grid-cols-3 gap-1 text-center text-xs">
            <span className="font-bold truncate">{game.players[0].name}</span>
            <span className="text-muted-foreground">Ziel</span>
            <span className="font-bold truncate">{game.players[1].name}</span>
            {CRICKET_NUMBERS.map((num) => {
              const p1m = game.cricket![0].marks[num] || 0;
              const p2m = game.cricket![1].marks[num] || 0;
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

      {/* Score input — disabled during a bot's turn */}
      <DartScoreInput selectedValue={selectedScore} selectedMultiplier={multiplier} isDisabled={game.isFinished || !!currentPlayer?.isBot}
        onValueSelect={setSelectedScore} onMultiplierSelect={setMultiplier} onSubmit={throwDart}
        onQuickRound={!isCricket && !currentPlayer?.isBot ? handleQuickRound : undefined} />

      {/* Undo & actions row */}
      <div className="flex gap-2 mt-3">
        <Button variant="outline" onClick={undoLastDart} disabled={undoStack.length === 0} className="flex-1 gap-1">
          <Undo2 className="w-4 h-4" /> Rückgängig
        </Button>
        <Button
          variant={cameraEnabled ? "default" : "outline"}
          onClick={() => setCameraEnabled((v) => !v)}
          disabled={!!currentPlayer?.isBot}
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
                          <button onClick={() => deleteThrow(activeIdx, globalIdx)}
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
