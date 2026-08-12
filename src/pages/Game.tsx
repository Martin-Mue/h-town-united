import { useState, useMemo, useEffect, useRef } from "react";
import { RotateCcw, Trophy, Target, Edit2, X, Users, Undo2, Volume2, VolumeX, Camera, Mic, MicOff, Bot, Plus, Minus, Keyboard, ChevronUp, ChevronDown, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import DartScoreInput from "@/components/game/DartScoreInput";
import CheckoutSuggestion from "@/components/game/CheckoutSuggestion";
import LiveCamera, { type DetectedDart, type LiveCameraHandle } from "@/components/game/LiveCamera";
import ThrowClipDialog, { type ThrowClipPopup } from "@/components/game/ThrowClipDialog";
import type { GameMode, GameState, LegState, DartThrow, CricketPlayerState, PlayerSlot, TeamSlot, BotLevel } from "@/types/game";
import { CRICKET_NUMBERS } from "@/types/game";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { simulateBotVisit, simulateBotCricketDart } from "@/utils/botPlayer";
import {
  average as calculateAverage,
  highestVisit as getHighest3DartRound,
  first9Average as getFirst9Average,
  tonPlusCount as countTonPlusRounds,
  count180s,
  computeCheckoutStats,
  combineCheckoutStats,
} from "@/utils/dartStats";

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
import { speakSequence, buildRoundAnnouncement } from "@/utils/speech";
import { shareOrDownloadResultImage } from "@/utils/shareResultImage";
import { teamIndexFor } from "@/utils/teamUtils";
import { effectiveStartScore } from "@/utils/handicap";
import { saveGameRecord } from "@/lib/gameSync";
import { enqueueGameSave } from "@/lib/offlineQueue";
import { fetchClubPlayers, type ClubPlayer } from "@/lib/repositories/players";

const SPEECH_PREF_KEY = "dart-speech-enabled";
const MAX_PLAYERS = 8;

function createLegState(legNumber: number, startScore: number, startingPlayerIndex: number, players: PlayerSlot[], teams?: TeamSlot[]): LegState {
  const scoreSlots = teams?.length ?? players.length;
  return {
    legNumber,
    startingPlayerIndex,
    remaining: Array.from({ length: scoreSlots }, (_, i) => effectiveStartScore(startScore, players, i, teams)),
    throws: Array.from({ length: players.length }, () => []),
    startedScoring: teams
      ? Array.from({ length: scoreSlots }, (_, teamIdx) => !players.some((p, i) => teamIndexFor(teams, i) === teamIdx && p.doubleIn))
      : players.map((p) => !p.doubleIn),
  };
}
function createCricketState(numbers: readonly number[] = CRICKET_NUMBERS): CricketPlayerState {
  const marks: Record<number, number> = {};
  numbers.forEach((n) => (marks[n] = 0));
  return { marks, points: 0 };
}
/** 6 unique random numbers (1-20) plus Bull, freshly rolled — never memoized/cached across games. */
function generateRandomCricketNumbers(): number[] {
  const pool = Array.from({ length: 20 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return [...pool.slice(0, 6), 25];
}
function dartLabel(t: DartThrow): string {
  return t.baseValue === 0 ? "M" : t.baseValue === 25 ? (t.multiplier === 2 ? "BULL" : "25") : `${t.multiplier === 2 ? "D" : t.multiplier === 3 ? "T" : ""}${t.baseValue}`;
}


/** Undo snapshot for reverting last dart */
interface UndoSnapshot {
  game: GameState;
  dartsThisRound: number;
  turnStartRemaining: number;
}

const DEFAULT_NAMES = Array.from({ length: MAX_PLAYERS }, (_, i) => `Spieler ${i + 1}`);

const GamePage = () => {
  const [phase, setPhase] = useState<"setup" | "warmup" | "playing" | "postGame">("setup");
  const [mode, setMode] = useState<GameMode>("501");
  const [bestOfLegs, setBestOfLegs] = useState(1);
  const [maxRoundsX01, setMaxRoundsX01] = useState<number>(0); // 0 = unlimited
  const [customStartScore, setCustomStartScore] = useState(501);
  const [numPlayers, setNumPlayers] = useState(2);
  const [customCricket, setCustomCricket] = useState(false);
  const [teamMode, setTeamMode] = useState(false);
  const [teamNames, setTeamNames] = useState<[string, string]>(["Team 1", "Team 2"]);
  const [playerNames, setPlayerNames] = useState<string[]>([...DEFAULT_NAMES]);
  const [playerDoubleOut, setPlayerDoubleOut] = useState<boolean[]>(Array(MAX_PLAYERS).fill(true));
  const [playerDoubleIn, setPlayerDoubleIn] = useState<boolean[]>(Array(MAX_PLAYERS).fill(false));
  const [playerHandicap, setPlayerHandicap] = useState<number[]>(Array(MAX_PLAYERS).fill(0));
  const [warmupEnabled, setWarmupEnabled] = useState(false);
  const [warmupSeconds, setWarmupSeconds] = useState(60);
  const [warmupRemaining, setWarmupRemaining] = useState(0);
  const [warmupDarts, setWarmupDarts] = useState(0);
  const [warmupTotal, setWarmupTotal] = useState(0);
  const [warmupValue, setWarmupValue] = useState(20);
  const [warmupMultiplier, setWarmupMultiplier] = useState(1);
  const [playerIsBot, setPlayerIsBot] = useState<boolean[]>(Array(MAX_PLAYERS).fill(false));
  const [playerBotLevel, setPlayerBotLevel] = useState<BotLevel[]>(Array(MAX_PLAYERS).fill("medium"));
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
  const [sharingResult, setSharingResult] = useState(false);
  const [gameSaved, setGameSaved] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const savingRef = useRef(false);
  const [dbPlayers, setDbPlayers] = useState<ClubPlayer[]>([]);
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [pendingCameraDarts, setPendingCameraDarts] = useState<DetectedDart[]>([]);
  const liveCameraRef = useRef<LiveCameraHandle>(null);
  const [clipPopup, setClipPopup] = useState<ThrowClipPopup | null>(null);
  // While the camera is on, the game view becomes a fixed, non-scrolling window — the
  // manual number pad isn't needed for scoring then, so it's tucked behind this toggle.
  const [showManualInput, setShowManualInput] = useState(false);
  // Generated up front (before the game row exists) so highlight clips captured
  // mid-game can already reference the game they'll end up saved under.
  const pendingGameIdRef = useRef<string>(crypto.randomUUID());
  const [botThinking, setBotThinking] = useState(false);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const botPlanRef = useRef<{ key: string; darts: DartThrow[]; applied: number } | null>(null);
  const [checkoutRates, setCheckoutRates] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchClubPlayers().then(setDbPlayers).catch((err) => console.error("fetchClubPlayers failed", err));
  }, []);

  // Fetches the current player's career checkout conversion rate on demand (once per
  // player per session) so CheckoutSuggestion can show "how often do I actually convert this".
  useEffect(() => {
    if (!game || game.mode === "cricket" || phase !== "playing") return;
    const player = game.players[game.currentPlayerIndex];
    if (!player || player.isBot || checkoutRates[player.name] !== undefined) return;
    const match = dbPlayers.find((p) => p.name === player.name);
    if (!match) return;
    supabase
      .from("game_legs")
      .select("throws, starting_score")
      .eq("player_id", match.id)
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        const combined = combineCheckoutStats(
          (data as any[]).map((leg) => computeCheckoutStats(leg.throws as DartThrow[], leg.starting_score))
        );
        if (combined.attempts > 0) setCheckoutRates((prev) => ({ ...prev, [player.name]: combined.percentage }));
      });
  }, [game?.currentPlayerIndex, game?.mode, phase, dbPlayers]);

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
    const n = numPlayers;
    const players: PlayerSlot[] = Array.from({ length: n }, (_, i) => ({
      name: playerIsBot[i]
        ? BOT_PROFILES[playerBotLevel[i] ?? "medium"].name
        : (playerNames[i]?.trim() || `Spieler ${i + 1}`),
      doubleOut: playerDoubleOut[i] ?? true,
      doubleIn: playerDoubleIn[i] ?? false,
      isBot: mode === "cricket" ? playerIsBot[i] : playerIsBot[i],
      botLevel: playerBotLevel[i] ?? "medium",
      handicap: !teamMode && mode !== "cricket" ? (playerHandicap[i] || 0) : undefined,
    }));
    const teams = teamMode ? [{ name: teamNames[0].trim() || "Team 1" }, { name: teamNames[1].trim() || "Team 2" }] : undefined;
    const scoreSlots = teams?.length ?? n;
    const newGame: GameState = {
      mode, startScore, bestOfLegs, players,
      legsWon: Array(scoreSlots).fill(0),
      currentLeg: createLegState(1, startScore, 0, players, teams), completedLegs: [],
      currentPlayerIndex: 0, isFinished: false,
      maxRoundsX01: mode !== "cricket" && maxRoundsX01 > 0 ? maxRoundsX01 : undefined,
      teams,
    };
    if (mode === "cricket") {
      const cricketNumbers = customCricket ? generateRandomCricketNumbers() : [...CRICKET_NUMBERS];
      newGame.cricketNumbers = cricketNumbers;
      newGame.cricket = Array.from({ length: scoreSlots }, () => createCricketState(cricketNumbers));
    }
    setGame(newGame);
    setDartsThisRound(0);
    setTurnStartRemaining(newGame.currentLeg.remaining[0] ?? startScore);
    setUndoStack([]);
    botPlanRef.current = null;
    pendingGameIdRef.current = crypto.randomUUID();
    setQueuedOffline(false);
    if (warmupEnabled) {
      setWarmupRemaining(warmupSeconds);
      setWarmupDarts(0);
      setWarmupTotal(0);
      setWarmupValue(20);
      setWarmupMultiplier(1);
      setPhase("warmup");
    } else {
      setPhase("playing");
    }
  };

  // ─── warm-up (pre-match, doesn't touch game/stats) ──────────────────
  useEffect(() => {
    if (phase !== "warmup" || warmupRemaining <= 0) return;
    const t = setTimeout(() => setWarmupRemaining((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, warmupRemaining]);

  useEffect(() => {
    if (phase === "warmup" && warmupRemaining <= 0) setPhase("playing");
  }, [phase, warmupRemaining]);

  const submitWarmupDart = () => {
    const pts = warmupValue === 0 ? 0 : (warmupValue === 25 && warmupMultiplier === 3 ? 0 : warmupValue * warmupMultiplier);
    setWarmupTotal((t) => t + pts);
    setWarmupDarts((d) => d + 1);
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
    const idx = game.currentPlayerIndex;
    const n = game.players.length;
    const teamIdx = teamIndexFor(game.teams, idx);
    const remaining = game.currentLeg.remaining[teamIdx];
    const newDartsThisRound = dartsThisRound + 1;

    const requiresDoubleIn = game.players[idx].doubleIn ?? false;
    const alreadyStartedScoring = game.currentLeg.startedScoring?.[teamIdx] ?? true;
    const isQualifyingDouble = mul === 2 || (baseValue === 25 && mul === 2);
    const justGotIn = requiresDoubleIn && !alreadyStartedScoring && isQualifyingDouble;
    const stillWaitingForDoubleIn = requiresDoubleIn && !alreadyStartedScoring && !isQualifyingDouble;
    // While still waiting to get in, a non-double dart contributes 0 to remaining/stats — it's
    // still shown in the throw history with its real face value, just not counted.
    const effectivePoints = stillWaitingForDoubleIn ? 0 : points;
    const dart: DartThrow = { baseValue, multiplier: mul, points: effectivePoints };
    const newRemaining = remaining - effectivePoints;

    const activeDoubleOut = game.players[idx].doubleOut ?? true;
    const isBust = !stillWaitingForDoubleIn && (newRemaining < 0 || newRemaining === 1 ||
      (newRemaining === 0 && activeDoubleOut && mul !== 2 && !(baseValue === 25 && mul === 2)));

    if (isBust) {
      if (soundEnabled) playBustSound();
      setGame((prev) => {
        if (!prev) return prev;
        const updatedLeg: LegState = { ...prev.currentLeg, remaining: [...prev.currentLeg.remaining], throws: prev.currentLeg.throws.map(t => [...t]) };
        updatedLeg.remaining[teamIdx] = turnStartRemaining;
        updatedLeg.throws[idx] = updatedLeg.throws[idx].slice(0, updatedLeg.throws[idx].length - (newDartsThisRound - 1));
        const nextIdx = (idx + 1) % n;
        return { ...prev, currentLeg: updatedLeg, currentPlayerIndex: nextIdx };
      });
      setDartsThisRound(0);
      setTurnStartRemaining(game.currentLeg.remaining[teamIndexFor(game.teams, (idx + 1) % n)]);
      if (soundEnabled) setTimeout(() => playTurnSwitchSound(), 300);
      return;
    }

    if (soundEnabled) playThrowSound();

    setGame((prev) => {
      if (!prev) return prev;
      const updatedLeg: LegState = { ...prev.currentLeg, remaining: [...prev.currentLeg.remaining], throws: prev.currentLeg.throws.map(t => [...t]) };
      updatedLeg.remaining[teamIdx] = newRemaining;
      updatedLeg.throws[idx] = [...updatedLeg.throws[idx], dart];
      if (justGotIn) {
        updatedLeg.startedScoring = (updatedLeg.startedScoring ?? prev.players.map(() => true)).map((v, i) => i === teamIdx ? true : v);
      }

      // Checkout
      if (newRemaining === 0) {
        updatedLeg.winnerIndex = teamIdx;
        const legsWon = [...prev.legsWon];
        legsWon[teamIdx] += 1;
        const legsToWin = Math.ceil(prev.bestOfLegs / 2);
        const updated: GameState = { ...prev, currentLeg: updatedLeg, legsWon };

        if (legsWon[teamIdx] >= legsToWin) {
          updated.isFinished = true;
          updated.winnerName = prev.teams ? prev.teams[teamIdx].name : prev.players[idx].name;
          updated.winnerIndex = teamIdx;
        } else {
          updated.completedLegs = [...prev.completedLegs, updatedLeg];
          const nextStarter = (updatedLeg.startingPlayerIndex + 1) % n;
          updated.currentLeg = createLegState(updatedLeg.legNumber + 1, prev.startScore, nextStarter, prev.players, prev.teams);
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
          const rounds = prev.players.map((_, i) => Math.ceil(updatedLeg.throws[i].length / 3));
          const scoreSlotRounds = updatedLeg.remaining.map((_, si) => Math.max(...rounds.filter((_, i) => teamIndexFor(prev.teams, i) === si)));
          if (scoreSlotRounds.every(r => r >= cap)) {
            const minRemaining = Math.min(...updatedLeg.remaining);
            const winners = updatedLeg.remaining.reduce<number[]>((acc, r, i) => (r === minRemaining ? [...acc, i] : acc), []);
            if (winners.length === 1) {
              const legWinner = winners[0];
              updatedLeg.winnerIndex = legWinner;
              const legsWon = [...prev.legsWon];
              legsWon[legWinner] += 1;
              const legsToWin = Math.ceil(prev.bestOfLegs / 2);
              const finished = legsWon[legWinner] >= legsToWin;
              const winnerName = prev.teams ? prev.teams[legWinner].name : prev.players[legWinner].name;
              if (finished) {
                return { ...next, currentLeg: updatedLeg, legsWon, isFinished: true, winnerName, winnerIndex: legWinner };
              }
              const nextStarter = (legWinner + 1) % n;
              return { ...next, completedLegs: [...prev.completedLegs, updatedLeg], legsWon, currentLeg: createLegState(updatedLeg.legNumber + 1, prev.startScore, nextStarter, prev.players, prev.teams), currentPlayerIndex: nextStarter };
            }
          }
        }
        return next;
      }

      return { ...prev, currentLeg: updatedLeg };
    });

    if (newRemaining === 0) {
      setDartsThisRound(0);
      const nextStarter = (game.currentLeg.startingPlayerIndex + 1) % n;
      setTurnStartRemaining(effectiveStartScore(game.startScore, game.players, nextStarter, game.teams));
      const legsWon = game.legsWon[teamIdx] + 1;
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
      const roundTotal = roundThrows.reduce((s, t) => s + t.points, 0) + effectivePoints;
      if (soundEnabled) {
        if (roundTotal === 180) setTimeout(() => play180Sound(), 100);
        else if (roundTotal >= 100) setTimeout(() => playTonPlusSound(), 100);
        else setTimeout(() => playTurnSwitchSound(), 100);
      }
      setDartsThisRound(0);
      setTurnStartRemaining(game.currentLeg.remaining[teamIndexFor(game.teams, (idx + 1) % game.players.length)]);
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
      const n = prev.players.length;
      const teamIdx = teamIndexFor(prev.teams, idx);
      const cricketNumbers = prev.cricketNumbers ?? CRICKET_NUMBERS;
      const cricket = prev.cricket!.map(c => ({ ...c, marks: { ...c.marks } }));
      const myState = cricket[teamIdx];
      const others = cricket.filter((_, j) => j !== teamIdx);

      if ((cricketNumbers as readonly number[]).includes(targetNumber) && targetNumber !== 0) {
        const hitsToAdd = baseValue === 50 ? 2 : mul;
        const currentMarks = myState.marks[targetNumber] || 0;
        const newMarks = currentMarks + hitsToAdd;
        myState.marks[targetNumber] = newMarks;
        const stillOpenForSomeoneElse = others.some(o => (o.marks[targetNumber] || 0) < 3);
        if (newMarks > 3 && stillOpenForSomeoneElse) {
          const scorableHits = newMarks - Math.max(currentMarks, 3);
          myState.points += targetNumber * scorableHits;
        }
      }

      const updatedLeg: LegState = { ...prev.currentLeg, throws: prev.currentLeg.throws.map(t => [...t]) };
      updatedLeg.throws[idx] = [...updatedLeg.throws[idx], dart];

      const updated: GameState = { ...prev, currentLeg: updatedLeg, cricket };

      const allClosed = cricketNumbers.every((num) => (myState.marks[num] || 0) >= 3);
      const hasHighestPoints = others.every(o => myState.points >= o.points);
      if (allClosed && hasHighestPoints) {
        updatedLeg.winnerIndex = teamIdx;
        updated.isFinished = true;
        updated.winnerName = prev.teams ? prev.teams[teamIdx].name : prev.players[idx].name;
        updated.winnerIndex = teamIdx;
      } else if (newDartsThisRound >= 3) {
        updated.currentPlayerIndex = (idx + 1) % n;
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

  /** Uploads a captured highlight clip in the background — playback already uses the local blob URL, this just makes it browsable later. */
  const uploadHighlightClip = async (params: {
    blob: Blob; mime: string; playerName: string; kind: "180" | "checkout" | "ton_plus"; points: number; darts: DetectedDart[];
  }) => {
    const userId = session?.user?.id;
    if (!userId) return;
    try {
      const ext = params.mime.includes("mp4") ? "mp4" : "webm";
      const path = `${userId}/${pendingGameIdRef.current}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("dart-clips").upload(path, params.blob, { contentType: params.mime });
      if (upErr) throw upErr;
      const playerMatch = dbPlayers.find(p => p.name === params.playerName);
      const { error: insErr } = await supabase.from("highlight_clips").insert({
        user_id: userId,
        game_id: pendingGameIdRef.current,
        player_id: playerMatch?.id || null,
        player_name: params.playerName,
        kind: params.kind,
        points: params.points,
        darts: params.darts as any,
        storage_path: path,
        mime: params.mime,
      });
      if (insErr) throw insErr;
    } catch (err) {
      console.error("highlight clip upload failed", err);
    }
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
      const teamIdx = teamIndexFor(curGame.teams, idx);
      const points = d.baseValue === 25 && d.multiplier === 3 ? 0 : d.baseValue * d.multiplier;
      const dart: DartThrow = { baseValue: d.baseValue, multiplier: d.multiplier, points, boardU: d.boardU, boardV: d.boardV };

      if (curGame.mode === "cricket") {
        const cricketNumbers = curGame.cricketNumbers ?? CRICKET_NUMBERS;
        const myState = curGame.cricket![teamIdx];
        const others = curGame.cricket!.filter((_, j) => j !== teamIdx);
        const targetNumber = d.baseValue === 50 ? 25 : d.baseValue;
        if ((cricketNumbers as readonly number[]).includes(targetNumber) && targetNumber !== 0) {
          const hitsToAdd = d.baseValue === 50 ? 2 : d.multiplier;
          const currentMarks = myState.marks[targetNumber] || 0;
          const newMarks = currentMarks + hitsToAdd;
          myState.marks = { ...myState.marks, [targetNumber]: newMarks };
          const stillOpenForSomeoneElse = others.some(o => (o.marks[targetNumber] || 0) < 3);
          if (newMarks > 3 && stillOpenForSomeoneElse) {
            const scorableHits = newMarks - Math.max(currentMarks, 3);
            myState.points += targetNumber * scorableHits;
          }
        }
        curGame.currentLeg.throws[idx] = [...curGame.currentLeg.throws[idx], dart];
        const allClosed = cricketNumbers.every((num) => (myState.marks[num] || 0) >= 3);
        const hasHighestPoints = others.every(o => myState.points >= o.points);
        if (allClosed && hasHighestPoints) {
          curGame.currentLeg.winnerIndex = teamIdx;
          curGame.isFinished = true;
          curGame.winnerName = curGame.teams ? curGame.teams[teamIdx].name : curGame.players[idx].name;
          curGame.winnerIndex = teamIdx;
          checkedOut = true;
        }
        curDarts += 1;
        continue;
      }

      // X01 modes
      const remaining = curGame.currentLeg.remaining[teamIdx];
      const newDartsThisRound = curDarts + 1;
      const mul: number = d.multiplier;
      const isDoubleOut = mul === 2;

      const requiresDoubleIn = curGame.players[idx].doubleIn ?? false;
      const alreadyStartedScoring = curGame.currentLeg.startedScoring?.[teamIdx] ?? true;
      const justGotIn = requiresDoubleIn && !alreadyStartedScoring && isDoubleOut;
      const stillWaitingForDoubleIn = requiresDoubleIn && !alreadyStartedScoring && !isDoubleOut;
      const effectivePoints = stillWaitingForDoubleIn ? 0 : points;
      const newRemaining = remaining - effectivePoints;

      const x01Dart: DartThrow = { baseValue: d.baseValue, multiplier: d.multiplier, points: effectivePoints, boardU: d.boardU, boardV: d.boardV };
      const activeDoubleOut = curGame.players[idx].doubleOut ?? true;
      const isBust = !stillWaitingForDoubleIn && (newRemaining < 0 || newRemaining === 1 ||
        (newRemaining === 0 && activeDoubleOut && !isDoubleOut));

      if (isBust) {
        curGame.currentLeg.remaining[teamIdx] = curStart;
        curGame.currentLeg.throws[idx] = curGame.currentLeg.throws[idx].slice(
          0, curGame.currentLeg.throws[idx].length - (newDartsThisRound - 1)
        );
        busted = true;
        break;
      }

      curGame.currentLeg.remaining[teamIdx] = newRemaining;
      curGame.currentLeg.throws[idx] = [...curGame.currentLeg.throws[idx], x01Dart];
      if (justGotIn) {
        curGame.currentLeg.startedScoring = (curGame.currentLeg.startedScoring ?? curGame.players.map(() => true)).map((v, i) => i === teamIdx ? true : v);
      }
      curDarts = newDartsThisRound;
      roundTotal += effectivePoints;

      if (newRemaining === 0) {
        curGame.currentLeg.winnerIndex = teamIdx;
        curGame.legsWon[teamIdx] += 1;
        const legsToWin = Math.ceil(curGame.bestOfLegs / 2);
        if (curGame.legsWon[teamIdx] >= legsToWin) {
          curGame.isFinished = true;
          curGame.winnerName = curGame.teams ? curGame.teams[teamIdx].name : curGame.players[idx].name;
          curGame.winnerIndex = teamIdx;
        } else {
          curGame.completedLegs = [...curGame.completedLegs, curGame.currentLeg];
          const nextStarter = (curGame.currentLeg.startingPlayerIndex + 1) % n;
          curGame.currentLeg = createLegState(curGame.currentLeg.legNumber + 1, curGame.startScore, nextStarter, curGame.players, curGame.teams);
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
        curStart = curGame.currentLeg.remaining[teamIndexFor(curGame.teams, nextIdx)];
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
      const remaining = curGame.mode === "cricket" ? undefined : game.currentLeg.remaining[teamIndexFor(game.teams, startIdx)];
      const { parts } = buildRoundAnnouncement({
        roundTotal, activePlayerName, nextPlayerName, remaining,
        isCricket: curGame.mode === "cricket",
        checkedOut: checkedOut && !curGame.isFinished,
        busted, matchWon: curGame.isFinished, winnerName: curGame.winnerName,
      });
      window.setTimeout(() => speakSequence(parts), 160);
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

    // Highlight → pull the just-recorded rolling-buffer clip, no manual recording needed.
    if (!busted && (checkedOut || roundTotal >= 100)) {
      const clip = liveCameraRef.current?.getRecentClip();
      if (clip) {
        setClipPopup({
          url: clip.url,
          mime: clip.mime,
          total: roundTotal,
          is180: roundTotal === 180,
          isCheckout: checkedOut,
          isTonPlus: roundTotal >= 100 && roundTotal !== 180,
          playerName: game.players[startIdx].name,
          darts,
          ts: Date.now(),
        });
        void uploadHighlightClip({
          blob: clip.blob,
          mime: clip.mime,
          playerName: game.players[startIdx].name,
          kind: roundTotal === 180 ? "180" : checkedOut ? "checkout" : "ton_plus",
          points: roundTotal,
          darts,
        });
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
      updatedLeg.remaining[teamIndexFor(prev.teams, playerIdx)] += removed.points;
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

  const shareResult = async () => {
    if (!game || !postGameStats || sharingResult) return;
    setSharingResult(true);
    try {
      await shareOrDownloadResultImage(
        {
          mode: game.mode === "custom" ? `Custom ${game.startScore}` : game.mode,
          winnerName: game.winnerName ?? "?",
          bestOfLegs: game.bestOfLegs,
          players: postGameStats.map((p) => ({ name: p.name, average: p.average, highscore: p.highscore, s180: p.s180, legs: p.legs })),
        },
        `ergebnis-${new Date().toISOString().slice(0, 10)}.png`
      );
    } finally {
      setSharingResult(false);
    }
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
      const teamIdx = teamIndexFor(game.teams, idx);
      if (game.mode === "cricket") {
        const cricketNumbers = game.cricketNumbers ?? CRICKET_NUMBERS;
        const others = game.cricket!.filter((_, j) => j !== teamIdx);
        // A number only still counts as "open" for the bot's targeting heuristic if at least
        // one opponent hasn't closed it yet — represented as the lowest mark count among them.
        const aggOppMarks: Record<number, number> = {};
        cricketNumbers.forEach((num) => {
          aggOppMarks[num] = others.length > 0 ? Math.min(...others.map(o => o.marks[num] || 0)) : 0;
        });
        const dart = simulateBotCricketDart(game.cricket![teamIdx].marks, aggOppMarks, level, cricketNumbers);
        handleCricketThrow(dart.baseValue, dart.multiplier as 1 | 2 | 3);
      } else {
        const key = `${idx}-${game.currentLeg.legNumber}-${dartsThisRound}`;
        let plan = botPlanRef.current;
        if (!plan || plan.key.split("-")[0] !== String(idx) || plan.key.split("-")[1] !== String(game.currentLeg.legNumber) || dartsThisRound === 0) {
          const mustDoubleIn = (player.doubleIn ?? false) && !(game.currentLeg.startedScoring?.[teamIdx] ?? true);
          const visit = simulateBotVisit(game.currentLeg.remaining[teamIdx], player.doubleOut ?? true, level, mustDoubleIn);
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
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("offline");
      await saveGameRecord(game, session?.user?.id, pendingGameIdRef.current);
      if (game.players.length > 2) {
        toast({ title: "Spiel gespeichert", description: "Alle Spieler wurden erfasst — der Turnierverlauf im Klassiker-Datensatz zeigt aber nur die Top 2." });
      }
    } catch (err) {
      // No connection (or a mid-request drop) — the result is far too valuable to lose, so
      // it's queued in IndexedDB and replayed automatically once the app is back online
      // (see offlineQueue.ts / App.tsx). The client-generated pendingGameIdRef keeps the
      // eventual insert idempotent even if this fires more than once.
      await enqueueGameSave({ id: pendingGameIdRef.current, game, userId: session?.user?.id });
      setQueuedOffline(true);
      toast({
        title: "Offline gespeichert",
        description: "Keine Verbindung — das Ergebnis bleibt auf diesem Gerät und synchronisiert automatisch, sobald wieder Netz da ist.",
      });
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
        legs: game.legsWon[teamIndexFor(game.teams, i)],
      };
    });
  }, [game?.isFinished]);

  // ─── SETUP PHASE ───────────────────────────────
  if (phase === "setup") {
    const activePlayerCount = numPlayers;
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

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <div className="min-w-0">
              <Label htmlFor="team-mode" className="text-sm">Team-Modus</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">2 Teams werfen abwechselnd, ein Teammitglied nach dem anderen, mit gemeinsamem Score.</p>
            </div>
            <Switch id="team-mode" checked={teamMode} onCheckedChange={(v) => {
              setTeamMode(v);
              if (v && (numPlayers < 4 || numPlayers % 2 !== 0)) setNumPlayers(4);
            }} />
          </div>

          {teamMode && (
            <div className="grid grid-cols-2 gap-2">
              <input value={teamNames[0]} onChange={(e) => setTeamNames([e.target.value, teamNames[1]])}
                placeholder="Team 1" className="rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground" />
              <input value={teamNames[1]} onChange={(e) => setTeamNames([teamNames[0], e.target.value])}
                placeholder="Team 2" className="rounded-lg bg-card border border-border px-3 py-2 text-sm text-foreground" />
            </div>
          )}

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{teamMode ? "Spieler pro Team" : "Anzahl Spieler"}</label>
            <div className="grid grid-cols-4 gap-2">
              {(teamMode ? [4, 6, 8] : Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => i + 2)).map((n) => (
                <button key={n} onClick={() => setNumPlayers(n)}
                  className={`rounded-lg border px-3 py-2 text-sm font-display transition-colors ${numPlayers === n ? "bg-primary/15 border-primary text-primary" : "bg-card border-border text-muted-foreground"}`}>
                  {teamMode ? `${n / 2} vs ${n / 2}` : `${n} Spieler`}
                </button>
              ))}
            </div>
          </div>

          {mode === "cricket" && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
              <div className="min-w-0">
                <Label htmlFor="custom-cricket" className="text-sm">Custom Cricket</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">6 zufällige Zahlen + Bull, jedes Spiel neu ausgelost – statt immer 20-15 + Bull.</p>
              </div>
              <Switch id="custom-cricket" checked={customCricket} onCheckedChange={setCustomCricket} />
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
              <div key={i} className={`bg-card rounded-lg border px-4 py-3 space-y-2 ${teamMode ? (i % 2 === 0 ? "border-primary/30" : "border-secondary/30") : "border-border"}`}>
                {teamMode && (
                  <p className={`text-[10px] font-display uppercase ${i % 2 === 0 ? "text-primary" : "text-secondary"}`}>
                    {i % 2 === 0 ? (teamNames[0] || "Team 1") : (teamNames[1] || "Team 2")}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  {playerIsBot[i] ? (
                    <div className="flex-1 rounded-lg bg-secondary/10 border border-secondary/40 px-3 py-2 text-sm text-secondary flex items-center gap-2 min-w-0">
                      <Bot className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{BOT_PROFILES[playerBotLevel[i]].name}</span>
                    </div>
                  ) : (
                  <>
                    <input
                      value={playerNames[i]}
                      onChange={(e) => setPlayerNames(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                      placeholder="Name eingeben..."
                      className="flex-1 rounded-lg bg-background border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground min-w-0 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    {dbPlayers.length > 0 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="shrink-0 rounded-lg border border-border px-2.5 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Vereinsmitglied wählen">
                            <Users className="w-3.5 h-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-2" align="end">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pb-1">Vereinsmitglied wählen</p>
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {dbPlayers.map((dp) => (
                              <button key={dp.id} onClick={() => setPlayerNames(prev => prev.map((v, idx) => idx === i ? dp.name : v))}
                                className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${playerNames[i] === dp.name ? "bg-primary/15 text-primary" : "hover:bg-muted"}`}>
                                <span>{dp.emoji}</span><span>{dp.name}</span>
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </>
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
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{playerDoubleIn[i] ? "Double In" : "Straight In"}</span>
                      <Switch checked={playerDoubleIn[i]} onCheckedChange={(v) => setPlayerDoubleIn(prev => prev.map((val, idx) => idx === i ? v : val))} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{playerDoubleOut[i] ? "Double Out" : "Single Out"}</span>
                      <Switch checked={playerDoubleOut[i]} onCheckedChange={(v) => setPlayerDoubleOut(prev => prev.map((val, idx) => idx === i ? v : val))} />
                    </div>
                    {!teamMode && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground" title="Startpunkte-Ausgleich für ungleich starke Spieler">Handicap</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            step={10}
                            value={playerHandicap[i] || 0}
                            onChange={(e) => {
                              const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                              setPlayerHandicap(prev => prev.map((val, idx) => idx === i ? v : val));
                            }}
                            className="w-16 rounded-lg bg-background border border-border px-2 py-1 text-sm text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <span className="text-[10px] text-muted-foreground">Punkte</span>
                        </div>
                      </div>
                    )}
                    {!teamMode && playerHandicap[i] > 0 && (
                      <p className="text-[10px] text-muted-foreground text-right -mt-1.5">
                        Startet bei {Math.max(2, getStartScore() - playerHandicap[i])} statt {getStartScore()}
                      </p>
                    )}
                  </>
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

          <div className="bg-card rounded-lg border border-border px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="warmup-mode" className="text-sm">Aufwärmen vor dem Match</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">Kurze Einwerf-Phase mit Timer — zählt nicht in die Statistik.</p>
              </div>
              <Switch id="warmup-mode" checked={warmupEnabled} onCheckedChange={setWarmupEnabled} />
            </div>
            {warmupEnabled && (
              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {[30, 60, 90, 120].map((s) => (
                  <button
                    key={s}
                    onClick={() => setWarmupSeconds(s)}
                    className={`rounded-lg py-1.5 text-xs font-display transition-colors ${warmupSeconds === s ? "bg-primary text-primary-foreground" : "bg-background border border-border text-muted-foreground"}`}
                  >
                    {s}s
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button onClick={startGame} className="w-full mt-4 font-display uppercase text-lg py-6">
            <Target className="w-5 h-5 mr-2" /> {warmupEnabled ? "Aufwärmen starten" : "Spiel starten"}
          </Button>
        </div>
      </div>
    );
  }

  // ─── WARM-UP PHASE ─────────────────────────────────
  if (phase === "warmup") {
    const mm = Math.floor(warmupRemaining / 60);
    const ss = warmupRemaining % 60;
    return (
      <div className="container py-6 animate-slide-up max-w-lg mx-auto">
        <div className="text-center mb-4">
          <h2 className="text-2xl font-display uppercase text-primary">Aufwärmen</h2>
          <p className="text-xs text-muted-foreground mt-1">Frei einwerfen — zählt nicht in die Statistik.</p>
        </div>

        <div className="bg-card rounded-2xl border border-primary/30 glow-cyan p-6 mb-4 text-center">
          <div className="font-display text-6xl tabular-nums text-primary">
            {mm}:{String(ss).padStart(2, "0")}
          </div>
          <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground">
            <span>{warmupDarts} Darts</span>
            <span>·</span>
            <span>{warmupTotal} Punkte</span>
          </div>
          <div className="flex items-center justify-center gap-2 mt-3">
            <Button size="sm" variant="outline" onClick={() => setWarmupRemaining((s) => s + 30)}>+30s</Button>
            <Button size="sm" variant="outline" onClick={() => setWarmupRemaining(0)}>Timer beenden</Button>
          </div>
        </div>

        <DartScoreInput
          selectedValue={warmupValue}
          selectedMultiplier={warmupMultiplier}
          isDisabled={false}
          onValueSelect={setWarmupValue}
          onMultiplierSelect={setWarmupMultiplier}
          onSubmit={submitWarmupDart}
        />

        <Button onClick={() => setPhase("playing")} className="w-full mt-4 font-display uppercase text-lg py-6">
          <Target className="w-5 h-5 mr-2" /> Los geht's
        </Button>
      </div>
    );
  }

  if (!game) return null;

  const activeIdx = game.currentPlayerIndex;
  const activeTeamIdx = teamIndexFor(game.teams, activeIdx);
  const currentPlayerName = game.players[activeIdx].name;
  const currentRemaining = game.currentLeg.remaining[activeTeamIdx];
  const currentThrows = game.currentLeg.throws[activeIdx];
  const scoreLabels = game.teams ? game.teams.map((t) => t.name) : game.players.map((p) => p.name);
  const numCols = scoreLabels.length <= 2 ? "grid-cols-2" : scoreLabels.length === 3 ? "grid-cols-3" : "grid-cols-2 md:grid-cols-4";
  const awaitingDoubleIn = !isCricket && (currentPlayer?.doubleIn ?? false) && !(game.currentLeg.startedScoring?.[activeTeamIdx] ?? true);

  const doubleInBanner = awaitingDoubleIn ? (
    <div className="mb-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-center text-xs text-accent font-display uppercase tracking-wide">
      Double In erforderlich – nur ein Doppel bringt {game.teams ? `${game.teams[activeTeamIdx].name} (${currentPlayerName})` : currentPlayerName} rein
    </div>
  ) : null;

  const cricketBoard = isCricket && game.cricket ? (
    <div className="bg-card rounded-xl border border-border p-3 mb-3 overflow-x-auto">
      <table className="w-full text-center text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left font-normal text-muted-foreground pb-1 pr-2">Ziel</th>
            {scoreLabels.map((name, i) => (
              <th key={i} className={`font-bold truncate px-1 pb-1 max-w-[4.5rem] ${i === activeTeamIdx ? "text-primary" : ""}`}>{name}</th>
            ))}
          </tr>
          {game.teams && (
            <tr>
              <th />
              {game.teams.map((_, ti) => (
                <th key={ti} className="font-normal text-[9px] text-muted-foreground truncate px-1 pb-1 max-w-[4.5rem]">
                  {game.players.filter((_, pi) => teamIndexFor(game.teams, pi) === ti).map((p) => p.name).join(" & ")}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {(game.cricketNumbers ?? CRICKET_NUMBERS).map((num) => (
            <tr key={num}>
              <td className="text-left font-display text-muted-foreground py-0.5 pr-2">{num === 25 ? "Bull" : num}</td>
              {game.cricket!.map((c, i) => {
                const m = c.marks[num] || 0;
                const renderMarks = (mm: number) => mm >= 3 ? "✕" : mm === 2 ? "╳" : mm === 1 ? "/" : "·";
                return (
                  <td key={i} className={`py-0.5 ${m >= 3 ? "text-secondary font-bold" : "text-muted-foreground"}`}>{renderMarks(m)}</td>
                );
              })}
            </tr>
          ))}
          <tr className="border-t border-border/50">
            <td className="text-left text-muted-foreground pt-1 pr-2">Punkte</td>
            {game.cricket!.map((c, i) => (
              <td key={i} className={`pt-1 font-display ${i === activeTeamIdx ? "text-primary font-bold" : ""}`}>{c.points}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  ) : null;

  // ─── PLAYING PHASE ─────────────────────────────────
  return (
    <div className={cameraEnabled
      ? "fixed inset-0 z-40 bg-background flex flex-col animate-slide-up"
      : "container py-4 animate-slide-up max-w-lg mx-auto"}>
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

            <div className="flex gap-2">
              <Button variant="outline" onClick={shareResult} disabled={sharingResult} className="gap-1.5 shrink-0">
                <Share2 className="w-4 h-4" /> {sharingResult ? "…" : "Teilen"}
              </Button>
              <Button onClick={() => { resetGame(); navigate("/game"); }} className="flex-1 font-display uppercase">Neues Spiel</Button>
            </div>
            {gameSaved && (
              <p className="text-[10px] text-muted-foreground mt-2">
                {queuedOffline ? "⏳ Offline gespeichert — wird synchronisiert, sobald wieder Netz da ist" : "✓ Spiel gespeichert"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Scoreboard (sticky in the scrolling layout; a fixed top bar in the camera window) */}
      <div className={cameraEnabled
        ? "shrink-0 px-4 pt-3 pb-2 bg-background/95 backdrop-blur border-b border-border/40"
        : "sticky top-0 z-30 -mx-4 px-4 pt-3 pb-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/40"}>
      <div className={`grid ${numCols} gap-3`}>
        {(game.teams
          ? game.teams.map((t, ti) => {
              const memberIdxs = game.players.map((_, pi) => pi).filter((pi) => teamIndexFor(game.teams, pi) === ti);
              const throws = memberIdxs.flatMap((pi) => game.currentLeg.throws[pi]);
              return {
                key: ti, label: t.name, subLabel: memberIdxs.map((pi) => game.players[pi].name).join(" & "),
                isBot: false, remaining: game.currentLeg.remaining[ti], cricketPoints: game.cricket?.[ti]?.points ?? 0,
                avg: calculateAverage(throws), p180: count180s(throws), legsWon: game.legsWon[ti],
                isActive: activeTeamIdx === ti,
              };
            })
          : game.players.map((p, i) => ({
              key: i, label: p.name, subLabel: undefined as string | undefined,
              isBot: p.isBot, remaining: game.currentLeg.remaining[i], cricketPoints: game.cricket?.[i]?.points ?? 0,
              avg: calculateAverage(game.currentLeg.throws[i]), p180: count180s(game.currentLeg.throws[i]),
              legsWon: game.legsWon[i], isActive: activeIdx === i,
            }))
        ).map((card) => {
          const isActive = card.isActive;
          const activeRound = isActive ? currentRoundScores : [];
          const pendingTotal = isActive && cameraEnabled
            ? pendingCameraDarts.reduce((s, d) => s + d.points, 0)
            : 0;
          const previewRemaining = !isCricket && pendingTotal > 0
            ? Math.max(0, card.remaining - pendingTotal)
            : card.remaining;
          const showPreview = pendingTotal > 0 && !isCricket;
          return (
            <div key={card.key}
              className={`bg-card rounded-xl p-4 border-2 transition-all text-center ${isActive ? "border-primary glow-cyan" : "border-border opacity-80"}`}>
              <div className="flex items-center justify-center gap-1.5">
                {isActive && <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse-glow" />}
                {card.isBot && <Bot className="w-3 h-3 text-secondary shrink-0" />}
                <p className={`text-sm truncate ${isActive ? "text-primary font-semibold" : "text-muted-foreground"}`}>{card.label}</p>
              </div>
              {card.subLabel && (
                <p className={`text-[10px] truncate ${isActive ? "text-primary/70" : "text-muted-foreground/70"}`}>
                  {card.subLabel}{isActive ? ` · dran: ${currentPlayerName}` : ""}
                </p>
              )}
              {isActive && card.isBot && botThinking ? (
                <p className="text-sm font-display mt-1 text-secondary animate-pulse">Bot wirft…</p>
              ) : (
                <p className={`text-4xl font-display mt-1 transition-colors ${
                  showPreview ? "text-accent" : isActive ? "text-foreground" : "text-muted-foreground"
                }`}>
                  {isCricket ? card.cricketPoints : previewRemaining}
                </p>
              )}
              {showPreview && (
                <p className="text-[10px] text-muted-foreground -mt-1">
                  ({card.remaining} − {pendingTotal} live)
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
                <span>Ø {card.avg.toFixed(1)}</span>
                {game.bestOfLegs > 1 && <span className="text-primary font-bold">{card.legsWon} Legs</span>}
                {card.p180 > 0 && <span className="text-accent font-bold">🎯{card.p180}</span>}
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

      <ThrowClipDialog
        popup={clipPopup}
        onClose={() => {
          if (clipPopup) URL.revokeObjectURL(clipPopup.url);
          setClipPopup(null);
        }}
      />

      {cameraEnabled ? (
        <>
          {/* Everything below the scoreboard scrolls WITHIN this region only — the
              outer window (and the page behind it) never scrolls while the camera is open. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
            {doubleInBanner}
            {!isCricket && !currentPlayer?.isBot && !awaitingDoubleIn && <div className="mt-3 mb-3"><CheckoutSuggestion remaining={currentRemaining} playerName={currentPlayerName} personalCheckoutRate={checkoutRates[currentPlayerName] ?? null} /></div>}

            {!currentPlayer?.isBot && (
              <LiveCamera
                ref={liveCameraRef}
                enabled={cameraEnabled}
                onClose={() => { setCameraEnabled(false); setPendingCameraDarts([]); }}
                onRoundCommit={submitDetectedRound}
                onPendingChange={setPendingCameraDarts}
                dartsRemaining={Math.max(1, 3 - dartsThisRound)}
                playerName={currentPlayerName}
                onRequestManualEntry={() => setShowManualInput(true)}
              />
            )}

            {cricketBoard}

            {/* Manual entry stays fully available — just tucked away by default since the camera scores for you. */}
            <button
              onClick={() => setShowManualInput((v) => !v)}
              className="w-full flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted mb-3"
            >
              <span className="flex items-center gap-1.5"><Keyboard className="w-3.5 h-3.5" /> Manuelle Eingabe</span>
              {showManualInput ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showManualInput && (
              <>
                <DartScoreInput selectedValue={selectedScore} selectedMultiplier={multiplier} isDisabled={game.isFinished || !!currentPlayer?.isBot}
                  onValueSelect={setSelectedScore} onMultiplierSelect={setMultiplier} onSubmit={throwDart}
                  onQuickRound={!isCricket && !currentPlayer?.isBot ? handleQuickRound : undefined} />

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
                                    t.multiplier === 3 ? "bg-primary/20 text-primary" :
                                    t.multiplier === 2 ? "bg-secondary/20 text-secondary" : "bg-muted text-foreground"
                                  }`}>
                                    {t.multiplier === 3 ? "T" : t.multiplier === 2 ? "D" : ""}{t.baseValue === 50 ? "Bull" : t.baseValue === 0 ? "Miss" : t.baseValue}
                                  </span>
                                  {editingThrowIdx !== null && (
                                    <button onClick={() => deleteThrow(activeIdx, globalIdx)}
                                      title="Wurf löschen" aria-label="Wurf löschen"
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
              </>
            )}

            <Button variant="ghost" onClick={resetGame} className="w-full mt-3 text-muted-foreground">
              <RotateCcw className="w-4 h-4 mr-2" /> Spiel abbrechen
            </Button>
          </div>

          {/* Compact bottom bar — always reachable, no matter how tall the camera/manual-input content gets. */}
          <div className="shrink-0 border-t border-border bg-background/95 backdrop-blur px-4 py-2.5 flex gap-2">
            <Button variant="outline" onClick={undoLastDart} disabled={undoStack.length === 0} className="flex-1 gap-1">
              <Undo2 className="w-4 h-4" /> Rückgängig
            </Button>
            <Button
              variant={showManualInput ? "default" : "outline"}
              onClick={() => setShowManualInput((v) => !v)}
              className="gap-1"
              title="Manuelle Eingabe ein-/ausblenden"
            >
              <Keyboard className="w-4 h-4" />
            </Button>
            <Button
              variant="default"
              onClick={() => setCameraEnabled(false)}
              className="gap-1"
              title="Kamera schließen"
            >
              <Camera className="w-4 h-4" /> Cam an
            </Button>
            <Button variant="outline" onClick={() => setSoundEnabled(!soundEnabled)} className="gap-1" title={soundEnabled ? "Sound ausschalten" : "Sound einschalten"} aria-label={soundEnabled ? "Sound ausschalten" : "Sound einschalten"}>
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* Checkout suggestion */}
          {!isCricket && !currentPlayer?.isBot && <div className="mt-3 mb-3"><CheckoutSuggestion remaining={currentRemaining} playerName={currentPlayerName} personalCheckoutRate={checkoutRates[currentPlayerName] ?? null} /></div>}

          {/* Cricket scoreboard */}
          {cricketBoard}

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
              variant="outline"
              onClick={() => setCameraEnabled(true)}
              disabled={!!currentPlayer?.isBot}
              className="gap-1"
              title="Live-Kamera-Scoring"
            >
              <Camera className="w-4 h-4" /> Cam
            </Button>
            <Button variant="outline" onClick={() => setSoundEnabled(!soundEnabled)} className="gap-1" title={soundEnabled ? "Sound ausschalten" : "Sound einschalten"} aria-label={soundEnabled ? "Sound ausschalten" : "Sound einschalten"}>
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
        </>
      )}
    </div>
  );
};

export default GamePage;
