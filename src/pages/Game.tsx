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
import ConfettiBurst from "@/components/ConfettiBurst";
import AnimatedScore from "@/components/AnimatedScore";
import type { GameMode, GameState, LegState, DartThrow, CricketPlayerState, PlayerSlot, TeamSlot, BotLevel } from "@/types/game";
import { CRICKET_NUMBERS } from "@/types/game";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { recordMatchResult, pushLiveSnapshot } from "@/lib/tournamentMatchSync";
import { isBustThrow, isQualifyingDouble as qualifyingDouble, resolveX01Visit, pointsFor, dartLabel } from "@/utils/x01Rules";
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
  playVictorySound, playTonPlusSound, playTurnSwitchSound, playWalkonSound,
} from "@/utils/sounds";
import { speakSequence, buildRoundAnnouncement, getCallerVoice, setCallerVoice, type CallerVoice } from "@/utils/speech";
import { shareOrDownloadResultImage } from "@/utils/shareResultImage";
import { teamIndexFor } from "@/utils/teamUtils";
import { effectiveStartScore } from "@/utils/handicap";
import { saveGameRecord } from "@/lib/gameSync";
import { enqueueGameSave, enqueueMatchResult } from "@/lib/offlineQueue";
import { fetchClubPlayers, matchClubPlayer, type ClubPlayer } from "@/lib/repositories/players";

const SPEECH_PREF_KEY = "dart-speech-enabled";
const WALKON_PREF_KEY = "dart-walkon-enabled";
/** How long the walk-on intro stays up before auto-advancing (ms) — also the window
 *  during which a tap skips straight to the match. */
const WALKON_DURATION_MS = 3200;
/** How long the follow-up stat-comparison screen stays up (ms) — longer than the walk-on
 *  card itself since there's actually something to read this time. */
const STATS_DURATION_MS = 4500;
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

/** Undo snapshot for reverting last dart */
interface UndoSnapshot {
  game: GameState;
  dartsThisRound: number;
  turnStartRemaining: number;
}

const DEFAULT_NAMES = Array.from({ length: MAX_PLAYERS }, (_, i) => `Spieler ${i + 1}`);

/**
 * Crash-recovery for an in-progress match — a page reload (pull-to-refresh triggered by
 * accident, a PWA update taking over, the tab getting killed) used to lose the whole game with
 * no way back. GameState is fully self-contained (players/scores/legs/throws/mode), so the
 * whole thing can just be mirrored to localStorage while playing and restored on next load —
 * no server round-trip needed, and it's already gone the moment the leg finishes (see
 * clearActiveGameSnapshot), since a finished game is the existing save/offline-queue path's job
 * to protect, not this one's.
 */
const ACTIVE_GAME_KEY = "dartcam-active-game-v1";
function loadActiveGameSnapshot(): GameState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_GAME_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}
function saveActiveGameSnapshot(game: GameState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_GAME_KEY, JSON.stringify(game));
  } catch {
    /* storage full/unavailable — not fatal, just no crash-recovery this session */
  }
}
function clearActiveGameSnapshot() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACTIVE_GAME_KEY);
}

const GamePage = () => {
  const [phase, setPhase] = useState<"setup" | "warmup" | "walkon" | "stats" | "playing" | "postGame">(() =>
    loadActiveGameSnapshot() ? "playing" : "setup"
  );
  const [mode, setMode] = useState<GameMode>("501");
  const [bestOfLegs, setBestOfLegs] = useState(1);
  const [maxRoundsX01, setMaxRoundsX01] = useState<number>(0); // 0 = unlimited
  const [customStartScore, setCustomStartScore] = useState(501);
  const [numPlayers, setNumPlayers] = useState(2);
  const [customCricket, setCustomCricket] = useState(false);
  const [teamMode, setTeamMode] = useState(false);
  // Who throws first in the match — a raw player index normally, but effectively a team choice
  // in team mode (0/1 pick each team's first member, matching the [TeamA-1, TeamB-1, TeamA-2,
  // TeamB-2, ...] interleaving createLegState/teamIndexFor already assume). Defaults to 0 (today's
  // fixed "player 1 starts"); the "Ausbullen" picker in setup just lets the group record who
  // actually won the bull-off instead.
  const [starterIndex, setStarterIndex] = useState(0);
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
  const [playerIsBot, setPlayerIsBot] = useState<boolean[]>(Array(MAX_PLAYERS).fill(false));
  const [playerBotLevel, setPlayerBotLevel] = useState<BotLevel[]>(Array(MAX_PLAYERS).fill("medium"));
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [speechEnabled, setSpeechEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(SPEECH_PREF_KEY);
    return raw ? raw !== "false" : true;
  });
  const [callerVoice, setCallerVoiceState] = useState<CallerVoice>(() => getCallerVoice());
  const changeCallerVoice = (v: CallerVoice) => {
    setCallerVoice(v);
    setCallerVoiceState(v);
  };
  const [walkonEnabled, setWalkonEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(WALKON_PREF_KEY);
    return raw ? raw !== "false" : true;
  });
  const [game, setGame] = useState<GameState | null>(() => loadActiveGameSnapshot());
  // Fallback defaults for handleX01Throw/handleCricketThrow when called without an explicit
  // dart (bot logic, camera detection) — DartScoreInput's buttons always pass explicit values.
  const selectedScore = 20;
  const multiplier = 1;
  const [editingThrowIdx, setEditingThrowIdx] = useState<number | null>(null);
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [sharingResult, setSharingResult] = useState(false);
  const [gameSaved, setGameSaved] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  // Computed once at mount (before any reset/finish can clear the snapshot) — whether this
  // page load recovered an in-progress game rather than starting fresh at "setup".
  const restoredFromSnapshotRef = useRef(phase === "playing" && !!game);
  useEffect(() => {
    if (restoredFromSnapshotRef.current) {
      toast({ title: "Spiel wiederhergestellt", description: "Nach einem Neuladen an der letzten Stelle weitergemacht." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Mirror the in-progress game to localStorage on every change — see loadActiveGameSnapshot's
  // doc comment. Cleared once the leg is decided (below) or on an explicit new-game reset
  // (resetGame), since a finished game's durability is the existing save/offline-queue path's
  // job, not this snapshot's.
  useEffect(() => {
    if (phase === "playing" && game && !game.isFinished) saveActiveGameSnapshot(game);
  }, [game, phase]);
  useEffect(() => {
    if (game?.isFinished) clearActiveGameSnapshot();
  }, [game?.isFinished]);
  /** Set once on mount when this game was launched from a tournament bracket match ("Spiel starten") — used to tag the saved game and write the result back into the bracket on finish. */
  const tournamentLinkRef = useRef<{ tournamentId: string; matchId: string; tournamentName?: string } | null>(null);
  const [tournamentLinkName, setTournamentLinkName] = useState<string | null>(null);
  const savingRef = useRef(false);
  // Mirrors game.currentLeg.remaining, updated synchronously the instant a throw is processed —
  // not just on the next render. handleX01Throw reads from this instead of the `game` closure
  // specifically so two throws landing before React re-renders (a fast double-tap on two number
  // buttons, or a touchscreen double-touch) each see the OTHER's update instead of both computing
  // from the same stale remaining value and one silently clobbering the other's subtraction.
  const remainingRef = useRef<number[]>([]);
  const [dbPlayers, setDbPlayers] = useState<ClubPlayer[]>([]);
  // Head-to-head record for the walk-on screen — null while unresolved (no fetch fired yet,
  // or one of the two isn't a real roster player), { total: 0, ... } once fetched but this is
  // their first-ever meeting. Fetched once per game start (see startGame), not derived from
  // dbPlayers, since it needs the actual `games` history, not just roster totals. aAvg/bAvg are
  // each side's average SPECIFICALLY across these head-to-head games — deliberately separate
  // from their lifetime average (already shown from dbPlayers), since how someone plays against
  // this one specific opponent is its own, genuinely different number.
  const [walkonH2H, setWalkonH2H] = useState<{ aWins: number; bWins: number; total: number; aAvg: number; bAvg: number } | null>(null);
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  // Whether a human actually wants the camera on — distinct from cameraEnabled itself, which
  // the bot-auto-play effect below force-closes for bot turns. Lets the camera come back on its
  // own once play returns to a human, instead of the player having to re-tap "Cam" every turn.
  const cameraWantedRef = useRef(false);
  const [pendingCameraDarts, setPendingCameraDarts] = useState<DetectedDart[]>([]);
  // Set when a camera-detected round's total lands exactly on a finish under double-out AND the
  // visit mixes at least one double with at least one non-double dart — genuinely ambiguous from
  // a single end-of-visit photo (see resolveX01Visit's doc comment): it could be a valid checkout
  // (double thrown last) or a bust (a non-double landed on it last), and nothing in the unordered
  // detected set can tell those apart. Blocks further camera scanning (see the `enabled` prop
  // below) until the player says which dart actually finished it.
  const [pendingCheckoutChoice, setPendingCheckoutChoice] = useState<{ darts: DetectedDart[]; doubleIndexes: number[] } | null>(null);
  // Set when a leg hits its maxRoundsX01 cap tied on lowest remaining — there's no rule to break
  // that automatically, so ask who won the bull-off instead of leaving the leg stuck (see
  // handleX01Throw's cap-check and resolveTiebreak). tiedIndexes are score-slot indexes (team
  // index in team mode, player index otherwise) — same space as GameState.currentLeg.remaining.
  const [pendingTiebreak, setPendingTiebreak] = useState<{ tiedIndexes: number[] } | null>(null);
  const liveCameraRef = useRef<LiveCameraHandle>(null);
  const [clipPopup, setClipPopup] = useState<ThrowClipPopup | null>(null);
  const [confettiKey, setConfettiKey] = useState<number | null>(null);
  /** 180s and checkouts get a quick confetti burst — the same falling-piece look as the
   *  tournament trophy ceremony, minus the trophy. Not gated by soundEnabled since it's a
   *  separate visual layer, not a sound. */
  const triggerConfetti = () => {
    const key = Date.now();
    setConfettiKey(key);
    setTimeout(() => setConfettiKey((k) => (k === key ? null : k)), 3000);
  };
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
  // Briefly highlights a score slot's remaining number right when a round finishes (checkout,
  // bust, 3rd dart, or a committed camera round) — { slot, key } so re-triggering the same
  // slot twice in a row (e.g. two rounds without anyone else throwing) still re-plays the pulse.
  const [scoreFlash, setScoreFlash] = useState<{ slot: number; key: number } | null>(null);
  const flashScore = (slot: number) => {
    setScoreFlash((prev) => ({ slot, key: (prev?.key ?? 0) + 1 }));
    window.setTimeout(() => setScoreFlash((prev) => (prev?.slot === slot ? null : prev)), 900);
  };

  useEffect(() => {
    fetchClubPlayers().then(setDbPlayers).catch((err) => console.error("fetchClubPlayers failed", err));
  }, []);

  // Prefill from "Spiel starten" on a tournament bracket match — reads the launch query
  // string once on mount. Everything it sets stays a normal, editable setup value; only
  // the tournament/match id link (kept in a ref, never rendered as form state) is fixed.
  useEffect(() => {
    const tid = searchParams.get("tid");
    const mid = searchParams.get("mid");
    if (!tid || !mid) return;
    const tname = searchParams.get("tname") || undefined;
    tournamentLinkRef.current = { tournamentId: tid, matchId: mid, tournamentName: tname };
    setTournamentLinkName(tname || "Turnier");

    const p1 = searchParams.get("p1");
    const p2 = searchParams.get("p2");
    if (p1 || p2) {
      setPlayerNames((prev) => {
        const next = [...prev];
        if (p1) next[0] = p1;
        if (p2) next[1] = p2;
        return next;
      });
    }
    setTeamMode(false);
    setNumPlayers(2);

    const qMode = searchParams.get("mode");
    if (qMode === "501" || qMode === "301" || qMode === "cricket") setMode(qMode);

    const qBestOf = parseInt(searchParams.get("bestOf") || "", 10);
    if (Number.isFinite(qBestOf) && qBestOf > 0) setBestOfLegs(qBestOf);
    // Only ever read once, right after mount — re-running on every searchParams identity
    // change would clobber the scorekeeper's own edits to the setup form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pushes a lightweight "score right now" snapshot to the tournament's public live view while
  // a tournament-linked match is being played — debounced so it fires a couple seconds after
  // scoring settles down, not on every single dart. X01 only (cricket's "remaining" doesn't
  // apply); best-effort, never awaited/blocking, see pushLiveSnapshot's own doc comment.
  useEffect(() => {
    const link = tournamentLinkRef.current;
    if (!link || phase !== "playing" || !game || game.isFinished || game.mode === "cricket") return;
    const timer = window.setTimeout(() => {
      void pushLiveSnapshot(link.tournamentId, link.matchId, {
        remaining1: game.currentLeg.remaining[0],
        remaining2: game.currentLeg.remaining[1],
        legs1: game.legsWon[0] ?? 0,
        legs2: game.legsWon[1] ?? 0,
        updatedAt: new Date().toISOString(),
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [game?.currentLeg.remaining, game?.legsWon, game?.isFinished, game?.mode, phase]);

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
    if (typeof window === "undefined") return;
    window.localStorage.setItem(WALKON_PREF_KEY, JSON.stringify(walkonEnabled));
  }, [walkonEnabled]);

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
    // slice(-0) behaves like slice(0) (the whole array), not an empty slice — without the
    // guard, the moment it becomes a player's turn (before their first new dart this round),
    // this showed their ENTIRE leg history as "this round".
    return dartsThisRound > 0 ? throws.slice(-dartsThisRound) : [];
  }, [game, dartsThisRound, currentIdx]);

  const currentRoundTotal = currentRoundScores.reduce((s, t) => s + t.points, 0);

  const getStartScore = (): number => {
    if (mode === "cricket") return 0;
    if (mode === "custom") return customStartScore;
    return parseInt(mode);
  };

  // Fired once per match start (not a useEffect keyed on `game`, which changes on every dart) —
  // resolves both sides against the roster and pulls their head-to-head record for the walk-on
  // screen. Only meaningful for an individual 1v1: team games rank by one representative player
  // per team (see gameSync.ts's `ranking`), which isn't a stable "these two people's H2H".
  const loadWalkonH2H = async (players: PlayerSlot[], teams?: TeamSlot[]) => {
    setWalkonH2H(null);
    if (teams || players.length !== 2 || players[0].isBot || players[1].isBot) return;
    const a = matchClubPlayer(dbPlayers, players[0].name);
    const b = matchClubPlayer(dbPlayers, players[1].name);
    if (!a || !b || a.id === b.id) return;
    const { data, error } = await supabase.from("games")
      .select("winner_id, player1_id, player1_average, player2_average")
      .or(`and(player1_id.eq.${a.id},player2_id.eq.${b.id}),and(player1_id.eq.${b.id},player2_id.eq.${a.id})`);
    if (error || !data) return;
    let aAvgSum = 0;
    let bAvgSum = 0;
    data.forEach((g) => {
      const aIsP1 = g.player1_id === a.id;
      aAvgSum += Number(aIsP1 ? g.player1_average : g.player2_average);
      bAvgSum += Number(aIsP1 ? g.player2_average : g.player1_average);
    });
    setWalkonH2H({
      aWins: data.filter((g) => g.winner_id === a.id).length,
      bWins: data.filter((g) => g.winner_id === b.id).length,
      total: data.length,
      aAvg: data.length > 0 ? aAvgSum / data.length : 0,
      bAvg: data.length > 0 ? bAvgSum / data.length : 0,
    });
  };

  // Whether the follow-up stat-comparison screen (see the "stats" phase render below) has
  // anything worth showing — a real (non-team) 1v1 where at least one side matches a roster
  // player. Bot games, guest-vs-guest test rounds, and team matches skip straight from the
  // walk-on card to play, same as before this screen existed.
  const walkonHasStats = (g: GameState | null): boolean => {
    if (!g || g.teams || g.players.length !== 2) return false;
    return !!matchClubPlayer(dbPlayers, g.players[0].name) || !!matchClubPlayer(dbPlayers, g.players[1].name);
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
    // Team mode only ever offers a choice of 2 (which team starts, via each team's first
    // member); clamp defensively either way in case the player count shrank after picking a
    // starter further back in the list.
    const starter = teamMode ? (starterIndex % 2 === 0 ? 0 : 1) : Math.min(starterIndex, n - 1);
    const newGame: GameState = {
      mode, startScore, bestOfLegs, players,
      legsWon: Array(scoreSlots).fill(0),
      currentLeg: createLegState(1, startScore, starter, players, teams), completedLegs: [],
      currentPlayerIndex: starter, isFinished: false,
      maxRoundsX01: mode !== "cricket" && maxRoundsX01 > 0 ? maxRoundsX01 : undefined,
      teams,
    };
    if (mode === "cricket") {
      const cricketNumbers = customCricket ? generateRandomCricketNumbers() : [...CRICKET_NUMBERS];
      newGame.cricketNumbers = cricketNumbers;
      newGame.cricket = Array.from({ length: scoreSlots }, () => createCricketState(cricketNumbers));
    }
    setGame(newGame);
    void loadWalkonH2H(players, teams);
    setDartsThisRound(0);
    // Must read the CHOSEN starter's own slot, not always slot 0 — with per-player handicaps
    // (or asymmetric team scores) these differ, and turnStartRemaining is exactly what a bust
    // on the opening throw reverts to (see handleX01Throw's bust branch). Reading slot 0
    // unconditionally silently corrupted a non-player-0 starter's score by the handicap gap
    // the moment they busted their very first visit.
    setTurnStartRemaining(newGame.currentLeg.remaining[starter] ?? startScore);
    setUndoStack([]);
    botPlanRef.current = null;
    pendingGameIdRef.current = crypto.randomUUID();
    setQueuedOffline(false);
    if (warmupEnabled) {
      setWarmupRemaining(warmupSeconds);
      setWarmupDarts(0);
      setWarmupTotal(0);
      setPhase("warmup");
    } else {
      enterMatch();
    }
  };

  /** Goes from setup/warm-up into the actual match — via the walk-on intro if enabled. */
  const enterMatch = () => setPhase(walkonEnabled ? "walkon" : "playing");

  // ─── warm-up (pre-match, doesn't touch game/stats) ──────────────────
  useEffect(() => {
    if (phase !== "warmup" || warmupRemaining <= 0) return;
    const t = setTimeout(() => setWarmupRemaining((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, warmupRemaining]);

  useEffect(() => {
    if (phase === "warmup" && warmupRemaining <= 0) enterMatch();
  }, [phase, warmupRemaining]);

  // ─── walk-on intro (pre-match, doesn't touch game/stats) ────────────
  useEffect(() => {
    if (phase !== "walkon") return;
    if (soundEnabled) playWalkonSound();
    const t = setTimeout(() => setPhase(walkonHasStats(game) ? "stats" : "playing"), WALKON_DURATION_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // ─── stat-comparison screen (second walk-on beat) ────────────────────
  useEffect(() => {
    if (phase !== "stats") return;
    const t = setTimeout(() => setPhase("playing"), STATS_DURATION_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const submitWarmupDart = (value: number, multiplier: number) => {
    const pts = pointsFor(value, multiplier);
    setWarmupTotal((t) => t + pts);
    setWarmupDarts((d) => d + 1);
  };

  useEffect(() => {
    if (game) remainingRef.current = [...game.currentLeg.remaining];
  }, [game]);

  /** Save undo snapshot before each throw */
  const saveUndo = () => {
    if (!game) return;
    setUndoStack(prev => [...prev, { game: JSON.parse(JSON.stringify(game)), dartsThisRound, turnStartRemaining }]);
  };

  /** Undo the last dart throw */
  const undoLastDart = () => {
    if (undoStack.length === 0) return;
    // Both prompts point at darts/indexes from the round that's about to disappear underneath
    // them — undoing past it without clearing them first would leave a stale prompt on screen
    // whose answer would then reapply a round that no longer exists.
    if (pendingCheckoutChoice || pendingTiebreak) return;
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
    const points = pointsFor(baseValue, mul);
    const idx = game.currentPlayerIndex;
    const n = game.players.length;
    const teamIdx = teamIndexFor(game.teams, idx);
    const remaining = remainingRef.current[teamIdx] ?? game.currentLeg.remaining[teamIdx];
    const newDartsThisRound = dartsThisRound + 1;

    const requiresDoubleIn = game.players[idx].doubleIn ?? false;
    const alreadyStartedScoring = game.currentLeg.startedScoring?.[teamIdx] ?? true;
    const isQualifyingDouble = qualifyingDouble(mul);
    const justGotIn = requiresDoubleIn && !alreadyStartedScoring && isQualifyingDouble;
    const stillWaitingForDoubleIn = requiresDoubleIn && !alreadyStartedScoring && !isQualifyingDouble;
    // While still waiting to get in, a non-double dart contributes 0 to remaining/stats — it's
    // still shown in the throw history with its real face value, just not counted.
    const effectivePoints = stillWaitingForDoubleIn ? 0 : points;
    const dart: DartThrow = { baseValue, multiplier: mul, points: effectivePoints };
    const newRemaining = remaining - effectivePoints;

    const activeDoubleOut = game.players[idx].doubleOut ?? true;
    const isBust = !stillWaitingForDoubleIn && isBustThrow(remaining, effectivePoints, activeDoubleOut, isQualifyingDouble);

    if (isBust) {
      if (soundEnabled) playBustSound();
      // The only feedback a bust used to get was this sound (plus optional TTS) — with sound
      // off, or in a loud room, a player just sees their score silently hold and has no idea
      // why, which is exactly the kind of thing that causes a mid-match dispute later.
      toast({ title: "Überworfen!", description: `${game.players[idx].name} — Rest bleibt bei ${turnStartRemaining}.`, variant: "destructive" });
      remainingRef.current[teamIdx] = turnStartRemaining;
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
      flashScore(teamIdx);
      if (soundEnabled) setTimeout(() => playTurnSwitchSound(), 300);
      if (speechEnabled) {
        const { parts } = buildRoundAnnouncement({
          roundTotal: 0, activePlayerName: game.players[idx].name, nextPlayerName: game.players[(idx + 1) % n].name,
          isCricket: false, checkedOut: false, busted: true, matchWon: false,
        });
        window.setTimeout(() => speakSequence(parts), 380);
      }
      return;
    }

    if (soundEnabled) playThrowSound();

    remainingRef.current[teamIdx] = newRemaining;
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

    // Round-cap resolution, computed once here for the side effects below — mirrors the setGame
    // updater's own cap-check above (same inputs; a pure updater shouldn't itself decide what to
    // announce). Previously only the TIED case was computed out here (for the bull-off prompt);
    // the unique-winner case fell through to the generic "round continues" branch below, which
    // played the wrong sound, announced "not checked out" via speech, skipped confetti, and read
    // turnStartRemaining from the discarded old leg with the wrong next-player index.
    let capOutcome: { kind: "tied"; tiedIndexes: number[] } | { kind: "winner"; legWinner: number } | null = null;
    if (newRemaining !== 0 && newDartsThisRound >= 3) {
      const cap = game.maxRoundsX01;
      if (cap && cap > 0) {
        const throwsAfter = game.players.map((_, i) => (i === idx ? game.currentLeg.throws[i].length + 1 : game.currentLeg.throws[i].length));
        const roundsPerPlayer = throwsAfter.map((len) => Math.ceil(len / 3));
        const remainingAfter = game.currentLeg.remaining.map((r, si) => (si === teamIdx ? newRemaining : r));
        const scoreSlotRounds = remainingAfter.map((_, si) => Math.max(...roundsPerPlayer.filter((_, i) => teamIndexFor(game.teams, i) === si)));
        if (scoreSlotRounds.every((r) => r >= cap)) {
          const minRemaining = Math.min(...remainingAfter);
          const tied = remainingAfter.reduce<number[]>((acc, r, i) => (r === minRemaining ? [...acc, i] : acc), []);
          capOutcome = tied.length > 1 ? { kind: "tied", tiedIndexes: tied } : { kind: "winner", legWinner: tied[0] };
        }
      }
    }

    if (newRemaining === 0) {
      setDartsThisRound(0);
      const nextStarter = (game.currentLeg.startingPlayerIndex + 1) % n;
      setTurnStartRemaining(effectiveStartScore(game.startScore, game.players, nextStarter, game.teams));
      flashScore(teamIdx);
      const legsWon = game.legsWon[teamIdx] + 1;
      const legsToWin = Math.ceil(game.bestOfLegs / 2);
      const matchWon = legsWon >= legsToWin;
      triggerConfetti();
      if (soundEnabled) {
        if (matchWon) {
          setTimeout(() => playVictorySound(), 200);
        } else {
          setTimeout(() => playCheckoutSound(), 100);
        }
      }
      if (speechEnabled) {
        const winnerName = game.teams ? game.teams[teamIdx].name : game.players[idx].name;
        const { parts } = buildRoundAnnouncement({
          roundTotal: 0, activePlayerName: game.players[idx].name, nextPlayerName: game.players[nextStarter].name,
          isCricket: false, checkedOut: true, busted: false, matchWon, winnerName: matchWon ? winnerName : undefined,
        });
        window.setTimeout(() => speakSequence(parts), matchWon ? 300 : 200);
      }
    } else if (capOutcome?.kind === "winner") {
      // Leg (or match) decided by the round cap with a single lowest-remaining winner — the same
      // "leg won" side effects a normal checkout gets above, just keyed to the cap's winner
      // instead of whoever happened to throw the dart that reached the cap (rarely the same
      // player: the cap resolves for everyone at once, on whichever throw happens to complete it).
      const legWinner = capOutcome.legWinner;
      setDartsThisRound(0);
      const legsWon = game.legsWon[legWinner] + 1;
      const legsToWin = Math.ceil(game.bestOfLegs / 2);
      const matchWon = legsWon >= legsToWin;
      const nextStarter = (legWinner + 1) % n;
      setTurnStartRemaining(effectiveStartScore(game.startScore, game.players, nextStarter, game.teams));
      flashScore(legWinner);
      triggerConfetti();
      if (soundEnabled) {
        if (matchWon) setTimeout(() => playVictorySound(), 200);
        else setTimeout(() => playCheckoutSound(), 100);
      }
      if (speechEnabled) {
        const winnerName = game.teams ? game.teams[legWinner].name : game.players[legWinner].name;
        const { parts } = buildRoundAnnouncement({
          roundTotal: 0, activePlayerName: winnerName, nextPlayerName: game.players[nextStarter].name,
          isCricket: false, checkedOut: true, busted: false, matchWon, winnerName: matchWon ? winnerName : undefined,
        });
        window.setTimeout(() => speakSequence(parts), matchWon ? 300 : 200);
      }
    } else if (newDartsThisRound >= 3) {
      const roundThrows = game.currentLeg.throws[idx].slice(-2);
      const roundTotal = roundThrows.reduce((s, t) => s + t.points, 0) + effectivePoints;
      if (roundTotal === 180) triggerConfetti();
      if (soundEnabled) {
        if (roundTotal === 180) setTimeout(() => play180Sound(), 100);
        else if (roundTotal >= 100) setTimeout(() => playTonPlusSound(), 100);
        else setTimeout(() => playTurnSwitchSound(), 100);
      }
      setDartsThisRound(0);
      const nextIdx = (idx + 1) % game.players.length;
      setTurnStartRemaining(game.currentLeg.remaining[teamIndexFor(game.teams, nextIdx)]);
      flashScore(teamIdx);
      if (speechEnabled) {
        const { parts } = buildRoundAnnouncement({
          roundTotal, activePlayerName: game.players[idx].name, nextPlayerName: game.players[nextIdx].name,
          remaining: newRemaining,
          isCricket: false, checkedOut: false, busted: false, matchWon: false,
        });
        window.setTimeout(() => speakSequence(parts), 180);
      }
      if (capOutcome?.kind === "tied") setPendingTiebreak({ tiedIndexes: capOutcome.tiedIndexes });
    } else {
      setDartsThisRound(newDartsThisRound);
    }
  };

  /** Answers the bull-off prompt raised above when a round-limited leg ends tied — applies the
   *  chosen score slot as the leg winner through the same "leg won" transition every other path
   *  (checkout, cap reached with a unique winner) already uses. */
  const resolveTiebreak = (winnerIndex: number) => {
    if (!pendingTiebreak || !game) return;
    setPendingTiebreak(null);
    const n = game.players.length;
    const legsWon = game.legsWon[winnerIndex] + 1;
    const legsToWin = Math.ceil(game.bestOfLegs / 2);
    const matchWon = legsWon >= legsToWin;
    const winnerName = game.teams ? game.teams[winnerIndex].name : game.players[winnerIndex].name;
    setGame((prev) => {
      if (!prev) return prev;
      const updatedLeg: LegState = { ...prev.currentLeg, winnerIndex };
      const nextLegsWon = [...prev.legsWon];
      nextLegsWon[winnerIndex] += 1;
      if (nextLegsWon[winnerIndex] >= legsToWin) {
        return { ...prev, currentLeg: updatedLeg, legsWon: nextLegsWon, isFinished: true, winnerName, winnerIndex };
      }
      const nextStarter = (winnerIndex + 1) % n;
      return {
        ...prev,
        legsWon: nextLegsWon,
        completedLegs: [...prev.completedLegs, updatedLeg],
        currentLeg: createLegState(updatedLeg.legNumber + 1, prev.startScore, nextStarter, prev.players, prev.teams),
        currentPlayerIndex: nextStarter,
      };
    });
    setDartsThisRound(0);
    flashScore(winnerIndex);
    triggerConfetti();
    toast({ title: "Ausgebullt!", description: `${winnerName} gewinnt das Leg per Ausbullen.` });
    if (soundEnabled) setTimeout(() => (matchWon ? playVictorySound() : playCheckoutSound()), 100);
    if (speechEnabled) {
      const text = matchWon ? `${winnerName} gewinnt das Ausbullen und die Partie!` : `${winnerName} gewinnt das Ausbullen und damit das Leg!`;
      window.setTimeout(() => speakSequence([{ text }]), 200);
    }
  };

  const handleCricketThrow = (overrideBase?: number, overrideMul?: 1 | 2 | 3) => {
    if (!game || game.isFinished) return;
    saveUndo();
    const baseValue = overrideBase ?? selectedScore;
    const mul = overrideMul ?? multiplier;
    const points = pointsFor(baseValue, mul);
    const dart: DartThrow = { baseValue, multiplier: mul, points };
    const targetNumber = baseValue === 50 ? 25 : baseValue;
    const newDartsThisRound = dartsThisRound + 1;

    // Snapshot against the pre-throw state so the caller can announce "just closed a number"
    // right away, without waiting for the setGame update below to land.
    const idx = game.currentPlayerIndex;
    const n = game.players.length;
    const teamIdx = teamIndexFor(game.teams, idx);
    const cricketNumbers = game.cricketNumbers ?? CRICKET_NUMBERS;
    const marksBefore = game.cricket![teamIdx].marks[targetNumber] || 0;
    const isScoringNumber = (cricketNumbers as readonly number[]).includes(targetNumber) && targetNumber !== 0;
    const hitsToAdd = isScoringNumber ? (baseValue === 50 ? 2 : mul) : 0;
    const justClosedNumber = isScoringNumber && marksBefore < 3 && marksBefore + hitsToAdd >= 3;

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
      flashScore(teamIdx);
    } else {
      setDartsThisRound(newDartsThisRound);
    }

    if (speechEnabled && (justClosedNumber || newDartsThisRound >= 3)) {
      const nextIdx = (idx + 1) % n;
      const { parts } = buildRoundAnnouncement({
        roundTotal: 0, activePlayerName: game.players[idx].name, nextPlayerName: game.players[nextIdx].name,
        isCricket: true, checkedOut: false, busted: false, matchWon: false,
        cricketClosedLabel: justClosedNumber ? (targetNumber === 25 ? "Bull" : String(targetNumber)) : undefined,
      });
      window.setTimeout(() => speakSequence(parts), 150);
    }
  };

  /** Fired directly by DartScoreInput's number/target buttons — one tap registers the dart immediately. */
  const throwDart = (base: number, mul: number) => {
    if (game?.mode === "cricket") handleCricketThrow(base, mul as 1 | 2 | 3);
    else handleX01Throw(base, mul as 1 | 2 | 3);
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
  const submitDetectedRound = (
    darts: DetectedDart[],
    forced?: { kind: "checkout"; finisherIndex: number } | { kind: "bust" },
    // Quick-round entry ("just type the total") synthesizes plausible-looking darts purely to
    // make the math add up (see splitQuickRound) — they're invented, not what was really thrown,
    // so asking "which of these fabricated darts finished it" would be nonsensical. The player
    // typed a total that matches remaining exactly, so trust that as a deliberate, valid checkout
    // instead of surfacing the disambiguation prompt built for genuine (camera-sourced) ambiguity.
    autoResolveAmbiguousAsCheckout = false,
  ) => {
    if (!game || game.isFinished || darts.length === 0) return;
    if (currentPlayer?.isBot) return; // bots never use the camera

    const dartsToApply = darts.slice(0, 3);
    const startIdx = game.currentPlayerIndex;

    // X01 only (cricket marks accumulate order-independently within one visit — see
    // resolveX01Visit's doc comment for why X01 specifically needs this and cricket doesn't):
    // camera detection only ever sees the board once, after every dart in the visit is already
    // stuck in, so it has no way to know the real throw order. Resolve (or consume an
    // already-forced resolution coming back from the disambiguation prompt below) BEFORE
    // touching any game state or the undo stack, so a still-ambiguous round doesn't push a no-op
    // undo entry.
    let x01Outcome: ReturnType<typeof resolveX01Visit> | null = null;
    let x01VisitDarts: { points: number; isDouble: boolean }[] = [];
    let x01JustGotIn = false;
    if (game.mode !== "cricket") {
      const teamIdx = teamIndexFor(game.teams, startIdx);
      const player = game.players[startIdx];
      const remaining = game.currentLeg.remaining[teamIdx];
      const requiresDoubleIn = player.doubleIn ?? false;
      const alreadyStartedScoring = game.currentLeg.startedScoring?.[teamIdx] ?? true;
      const activeDoubleOut = player.doubleOut ?? true;
      // Simplification: with double-in still pending, if ANY dart this visit is a qualifying
      // double, treat the player as in for the WHOLE visit (every dart counts at face value)
      // rather than working out exactly which dart got them in — same "vision can't see order"
      // limitation as the bust/checkout ambiguity below, but lower-stakes (miscounts a few
      // points at most, never flips a match outcome), so this stays a documented approximation
      // instead of a second disambiguation prompt.
      const hasQualifyingDartThisVisit = dartsToApply.some((d) => d.multiplier === 2);
      x01JustGotIn = requiresDoubleIn && !alreadyStartedScoring && hasQualifyingDartThisVisit;
      const stillNotIn = requiresDoubleIn && !alreadyStartedScoring && !hasQualifyingDartThisVisit;
      x01VisitDarts = dartsToApply.map((d) => {
        const points = pointsFor(d.baseValue, d.multiplier);
        return { points: stillNotIn ? 0 : points, isDouble: d.multiplier === 2 };
      });
      x01Outcome = forced ?? resolveX01Visit(remaining, activeDoubleOut, x01VisitDarts);
      if (x01Outcome.kind === "ambiguous") {
        if (autoResolveAmbiguousAsCheckout) {
          x01Outcome = { kind: "checkout" };
        } else {
          setPendingCheckoutChoice({ darts: dartsToApply, doubleIndexes: x01Outcome.doubleIndexes });
          return;
        }
      }
    }

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
    // Set when a checkout already picked the next leg's starting player directly (below) — the
    // generic "advance to the next player" step further down must then be skipped, or it would
    // silently advance PAST that player and skip them for the whole new leg.
    let playerAlreadyAdvanced = false;

    if (curGame.mode === "cricket") {
      for (const d of dartsToApply) {
        if (curGame.isFinished) break;
        const idx = curGame.currentPlayerIndex;
        const teamIdx = teamIndexFor(curGame.teams, idx);
        const points = pointsFor(d.baseValue, d.multiplier);
        const dart: DartThrow = { baseValue: d.baseValue, multiplier: d.multiplier, points, boardU: d.boardU, boardV: d.boardV };

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
      }
    } else {
      // X01 — apply the already-resolved outcome (computed above, before the undo push) to the
      // WHOLE visit at once instead of dart-by-dart, since there's no real per-dart throw order
      // to walk through here.
      const idx = curGame.currentPlayerIndex;
      const teamIdx = teamIndexFor(curGame.teams, idx);
      const outcome = x01Outcome!;

      if (outcome.kind === "bust") {
        busted = true; // no throws recorded for a busted visit — matches the manual-entry convention
      } else {
        let orderedPairs = dartsToApply.map((d, i) => ({ d, points: x01VisitDarts[i].points }));
        if (outcome.kind === "checkout" && forced?.kind === "checkout") {
          // Cosmetic only (the ruling itself is already decided) — put the dart the player
          // actually confirmed as the finisher last in the recorded history, so anything
          // reading throw history later (highlight clips, the leg's throw list) shows a
          // sensible finish instead of an arbitrary detection order.
          const i = forced.finisherIndex;
          orderedPairs = [...orderedPairs.slice(0, i), ...orderedPairs.slice(i + 1), orderedPairs[i]];
        }
        roundTotal = x01VisitDarts.reduce((s, d) => s + d.points, 0);
        const dartThrows: DartThrow[] = orderedPairs.map(({ d, points }) => ({
          baseValue: d.baseValue, multiplier: d.multiplier, points, boardU: d.boardU, boardV: d.boardV,
        }));
        curGame.currentLeg.throws[idx] = [...curGame.currentLeg.throws[idx], ...dartThrows];
        curGame.currentLeg.remaining[teamIdx] = curGame.currentLeg.remaining[teamIdx] - roundTotal;
        if (x01JustGotIn) {
          curGame.currentLeg.startedScoring = (curGame.currentLeg.startedScoring ?? curGame.players.map(() => true)).map((v, i) => i === teamIdx ? true : v);
        }
        curDarts += dartsToApply.length;

        if (outcome.kind === "checkout") {
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
            curStart = curGame.currentLeg.remaining[teamIndexFor(curGame.teams, nextStarter)];
            playerAlreadyAdvanced = true;
          }
          checkedOut = true;
        }
      }
    }

    // Round-cap check (X01 only) — mirrors handleX01Throw's own capOutcome computation exactly.
    // The camera/quick-round path never checked maxRoundsX01 at all: a round-limited leg played
    // via camera just silently continued past its cap forever, since only manual entry had this.
    // Skipped once a real checkout or the match itself already decided things above — the cap is
    // moot once a leg has already ended some other way this same round.
    let capOutcome: { kind: "tied"; tiedIndexes: number[] } | { kind: "winner"; legWinner: number } | null = null;
    if (curGame.mode !== "cricket" && !busted && !checkedOut && !curGame.isFinished) {
      const cap = curGame.maxRoundsX01;
      if (cap && cap > 0) {
        const roundsPerPlayer = curGame.players.map((_, i) => Math.ceil(curGame.currentLeg.throws[i].length / 3));
        const scoreSlotRounds = curGame.currentLeg.remaining.map((_, si) =>
          Math.max(...roundsPerPlayer.filter((_, i) => teamIndexFor(curGame.teams, i) === si))
        );
        if (scoreSlotRounds.every((r) => r >= cap)) {
          const minRemaining = Math.min(...curGame.currentLeg.remaining);
          const tied = curGame.currentLeg.remaining.reduce<number[]>((acc, r, i) => (r === minRemaining ? [...acc, i] : acc), []);
          capOutcome = tied.length > 1 ? { kind: "tied", tiedIndexes: tied } : { kind: "winner", legWinner: tied[0] };
        }
      }
    }

    if (capOutcome?.kind === "winner") {
      // Same "leg won" treatment the checkout branch above gets, just keyed to the cap's unique
      // lowest-remaining winner instead of whoever threw the round that happened to reach the cap.
      const legWinner = capOutcome.legWinner;
      curGame.currentLeg.winnerIndex = legWinner;
      curGame.legsWon[legWinner] += 1;
      const legsToWin = Math.ceil(curGame.bestOfLegs / 2);
      if (curGame.legsWon[legWinner] >= legsToWin) {
        curGame.isFinished = true;
        curGame.winnerName = curGame.teams ? curGame.teams[legWinner].name : curGame.players[legWinner].name;
        curGame.winnerIndex = legWinner;
      } else {
        curGame.completedLegs = [...curGame.completedLegs, curGame.currentLeg];
        const nextStarter = (curGame.currentLeg.startingPlayerIndex + 1) % n;
        curGame.currentLeg = createLegState(curGame.currentLeg.legNumber + 1, curGame.startScore, nextStarter, curGame.players, curGame.teams);
        curGame.currentPlayerIndex = nextStarter;
        curStart = curGame.currentLeg.remaining[teamIndexFor(curGame.teams, nextStarter)];
        playerAlreadyAdvanced = true;
      }
      // Reusing checkedOut (rather than inventing a parallel flag) is deliberate: it's exactly
      // what drives the "leg just ended" sound/speech/confetti/highlight-clip side effects below,
      // and handleX01Throw's own cap-winner branch announces itself as checkedOut:true too.
      checkedOut = true;
    }

    if (!curGame.isFinished) {
      if (!playerAlreadyAdvanced && (busted || curDarts >= 1)) {
        const idx = curGame.currentPlayerIndex;
        const nextIdx = (idx + 1) % n;
        curGame.currentPlayerIndex = nextIdx;
        curStart = curGame.currentLeg.remaining[teamIndexFor(curGame.teams, nextIdx)];
        curDarts = 0;
      } else if (playerAlreadyAdvanced) {
        curDarts = 0;
      }
    } else {
      curDarts = 0;
    }

    setGame(curGame);
    setDartsThisRound(curDarts);
    setTurnStartRemaining(curStart);
    setPendingCameraDarts([]);
    flashScore(teamIndexFor(curGame.teams, startIdx));
    // Cap reached but tied on lowest remaining — same bull-off prompt handleX01Throw raises,
    // doesn't block the normal player-advance above (matches its behavior: the tie is a
    // separate blocking prompt, not a reason to leave the turn on the player who just threw).
    if (capOutcome?.kind === "tied") setPendingTiebreak({ tiedIndexes: capOutcome.tiedIndexes });

    // Same "give the player something to actually see" fix as the manual-entry bust path —
    // the camera flow used to rely on playBustSound()/TTS alone too.
    if (busted) {
      toast({ title: "Überworfen!", description: `${game.players[startIdx].name} — Rest bleibt bei ${curStart}.`, variant: "destructive" });
    }

    if (speechEnabled) {
      const activePlayerName = game.players[startIdx].name;
      const nextPlayerName = curGame.players[curGame.currentPlayerIndex].name;
      // curGame (post-round), not game (pre-round) — this is the player's NEW remaining after
      // the round just applied, which is what should be announced/checked for checkout range.
      const remaining = curGame.mode === "cricket" ? undefined : curGame.currentLeg.remaining[teamIndexFor(curGame.teams, startIdx)];
      const { parts } = buildRoundAnnouncement({
        roundTotal, activePlayerName, nextPlayerName, remaining,
        isCricket: curGame.mode === "cricket",
        checkedOut: checkedOut && !curGame.isFinished,
        busted, matchWon: curGame.isFinished, winnerName: curGame.winnerName,
      });
      window.setTimeout(() => speakSequence(parts), 160);
    }

    if (!busted && (checkedOut || roundTotal === 180)) triggerConfetti();
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

  /** Answers the "which dart finished it" prompt raised by submitDetectedRound when a
   *  camera-detected visit's total lands exactly on a finish under double-out with a genuine mix
   *  of doubles and non-doubles (see resolveX01Visit) — re-enters submitDetectedRound with the
   *  player's choice forced, so the actual game-state mutation goes through the exact same path
   *  a normal round would. */
  const resolveCheckoutChoice = (choice: number | "bust") => {
    const pending = pendingCheckoutChoice;
    if (!pending) return;
    setPendingCheckoutChoice(null);
    if (choice === "bust") {
      submitDetectedRound(pending.darts, { kind: "bust" });
    } else {
      submitDetectedRound(pending.darts, { kind: "checkout", finisherIndex: choice });
    }
  };

  const deleteThrow = (playerIdx: number, throwIndex: number) => {
    // If the deleted dart belonged to the current player's still-open round (one of the last
    // `dartsThisRound` entries), the round's dart counter must shrink with it — otherwise the
    // 3-dot counter and the "this round" scorecard chip stay one dart ahead of what's actually
    // left, and the next thrown dart lands at the wrong position in the round.
    let isCurrentRoundThrow = false;
    setGame((prev) => {
      if (!prev) return prev;
      const throws = [...prev.currentLeg.throws[playerIdx]];
      isCurrentRoundThrow = playerIdx === prev.currentPlayerIndex && throwIndex >= throws.length - dartsThisRound;
      const removed = throws.splice(throwIndex, 1)[0];
      const updatedLeg: LegState = { ...prev.currentLeg, throws: [...prev.currentLeg.throws], remaining: [...prev.currentLeg.remaining] };
      updatedLeg.throws[playerIdx] = throws;
      updatedLeg.remaining[teamIndexFor(prev.teams, playerIdx)] += removed.points;
      return { ...prev, currentLeg: updatedLeg };
    });
    if (isCurrentRoundThrow) setDartsThisRound((d) => Math.max(0, d - 1));
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
    submitDetectedRound(splitQuickRound(total), undefined, true);
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
    clearActiveGameSnapshot();
    setPhase("setup"); setGame(null); setGameSaved(false); setShowDetailedStats(false);
    setDartsThisRound(0); setUndoStack([]);
  };

  // ─── BOT AUTO-PLAY ─────────────────────────────────
  useEffect(() => {
    if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }
    if (!game || game.isFinished || phase !== "playing") { setBotThinking(false); return; }
    if (pendingTiebreak) { setBotThinking(false); return; } // frozen until the bull-off prompt is answered
    const idx = game.currentPlayerIndex;
    const player = game.players[idx];
    if (!player?.isBot) {
      setBotThinking(false);
      // Play returned to a human — restore the camera if it was only closed because a bot's
      // turn started, not because the human closed it themselves (see cameraWantedRef).
      if (cameraWantedRef.current && !cameraEnabled) setCameraEnabled(true);
      return;
    }
    if (cameraEnabled) setCameraEnabled(false); // bots never trigger the camera (preference remembered in cameraWantedRef)

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
  }, [game?.currentPlayerIndex, game?.currentLeg.legNumber, dartsThisRound, game?.isFinished, phase, pendingTiebreak]);

  const saveGame = async () => {
    if (!game || !game.isFinished || savingRef.current || gameSaved) return;
    savingRef.current = true;
    const link = tournamentLinkRef.current ?? undefined;
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("offline");
      await saveGameRecord(game, session?.user?.id, pendingGameIdRef.current, link);
      if (game.players.length > 2) {
        toast({ title: "Spiel gespeichert", description: "Alle Spieler wurden erfasst — der Turnierverlauf im Klassiker-Datensatz zeigt aber nur die Top 2." });
      }
      if (link) {
        try {
          await recordMatchResult(link.tournamentId, link.matchId, {
            winnerName: game.winnerName!,
            score1: game.legsWon[0],
            score2: game.legsWon[1],
          });
        } catch (syncErr) {
          // The game itself is safely saved either way — only the bracket write-back failed
          // (a transient request drop, not a full offline outage). Queue it for automatic
          // retry same as the offline case below, so this never falls back to manual entry
          // unless the retry queue itself later fails too.
          console.error("recordMatchResult failed, queuing for retry", syncErr);
          await enqueueMatchResult({
            id: `${pendingGameIdRef.current}-match`,
            tournamentId: link.tournamentId,
            matchId: link.matchId,
            winnerName: game.winnerName!,
            score1: game.legsWon[0],
            score2: game.legsWon[1],
          });
          toast({
            title: "Turnier wird nachgetragen",
            description: "Ergebnis konnte gerade nicht in den Turnierbaum übernommen werden — wird automatisch nachgeholt.",
          });
        }
      }
    } catch (err) {
      // No connection (or a mid-request drop) — the result is far too valuable to lose, so
      // it's queued in IndexedDB and replayed automatically once the app is back online
      // (see offlineQueue.ts / App.tsx). The client-generated pendingGameIdRef keeps the
      // eventual insert idempotent even if this fires more than once. The tournament bracket
      // write-back gets its own queue entry for the same reason — it needs a live read of the
      // bracket, so it can't just be retried as part of the game-save replay.
      await enqueueGameSave({ id: pendingGameIdRef.current, game, userId: session?.user?.id, tournamentLink: link });
      if (link) {
        await enqueueMatchResult({
          id: `${pendingGameIdRef.current}-match`,
          tournamentId: link.tournamentId,
          matchId: link.matchId,
          winnerName: game.winnerName!,
          score1: game.legsWon[0],
          score2: game.legsWon[1],
        });
      }
      setQueuedOffline(true);
      toast({
        title: "Offline gespeichert",
        description: link
          ? "Keine Verbindung — Ergebnis und Turnier-Eintrag bleiben auf diesem Gerät und synchronisieren automatisch, sobald wieder Netz da ist."
          : "Keine Verbindung — das Ergebnis bleibt auf diesem Gerät und synchronisiert automatisch, sobald wieder Netz da ist.",
      });
    }
    setGameSaved(true);
    savingRef.current = false;
  };

  useEffect(() => {
    if (game?.isFinished && !gameSaved && session?.user?.id) saveGame();
  }, [game?.isFinished]);

  // Cricket match-win announcement — X01 already announces its own win inline (checkout +
  // hype happen together there); cricket finishes on a mark, not a "checkout" moment, so it
  // gets its own decoupled trigger here instead of threading it through handleCricketThrow.
  const cricketWinAnnouncedRef = useRef(false);
  useEffect(() => {
    if (!game || game.mode !== "cricket") return;
    if (!game.isFinished) { cricketWinAnnouncedRef.current = false; return; }
    if (cricketWinAnnouncedRef.current || !speechEnabled) return;
    cricketWinAnnouncedRef.current = true;
    const { parts } = buildRoundAnnouncement({
      roundTotal: 0, activePlayerName: "", nextPlayerName: "",
      isCricket: true, checkedOut: false, busted: false, matchWon: true, winnerName: game.winnerName,
    });
    window.setTimeout(() => speakSequence(parts), 200);
  }, [game?.isFinished, game?.mode, speechEnabled]);

  const postGameStats = useMemo(() => {
    if (!game || !game.isFinished) return null;
    const allLegs = [...game.completedLegs, game.currentLeg];
    return game.players.map((p, i) => {
      const throws = allLegs.flatMap(l => l.throws[i] ?? []);
      // Checkout-Quote: tatsächliche Checkouts / Visits, in denen ein Checkout überhaupt
      // möglich war (remaining <= 170) — pro Leg berechnet, da "remaining" bei jedem Leg neu
      // beginnt (ein einzelner Wurf-Flatten über alle Legs würde den Rest-Score verfälschen).
      const checkout = game.mode === "cricket"
        ? { attempts: 0, hits: 0, percentage: 0, highestCheckout: 0 }
        : combineCheckoutStats(allLegs.map((leg) => computeCheckoutStats(leg.throws[i] ?? [], effectiveStartScore(game.startScore, game.players, i, game.teams))));
      return {
        name: p.name,
        average: calculateAverage(throws),
        highscore: getHighest3DartRound(throws),
        totalThrows: throws.length,
        checkout,
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
        <h2 className="text-2xl font-display uppercase mb-1 text-center">Neues Spiel</h2>
        {tournamentLinkName && (
          <p className="text-xs text-center text-primary mb-5">
            Turnier-Match · {tournamentLinkName} — Ergebnis wird nach Spielende automatisch im Turnierbaum eingetragen.
          </p>
        )}
        {!tournamentLinkName && <div className="mb-6" />}
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

          {speechEnabled && (
            <div className="bg-card rounded-lg border border-border px-4 py-3">
              <Label className="text-sm font-medium mb-2 block">Caller-Stimme</Label>
              <div className="grid grid-cols-4 gap-1.5">
                {([
                  { value: "auto", label: "Männlich" },
                  { value: "female", label: "Weiblich" },
                  { value: "yoda", label: "Yoda" },
                  { value: "herald", label: "Herold" },
                  { value: "kernasi", label: "Kernasi" },
                  { value: "reporter", label: "Reporter" },
                  { value: "genz", label: "Gen Z" },
                ] as { value: CallerVoice; label: string }[]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => changeCallerVoice(opt.value)}
                    className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                      callerVoice === opt.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-card rounded-lg border border-border px-4 py-3 space-y-2">
            <Label className="text-sm">Anwurf — wer beginnt?</Label>
            <p className="text-[10px] text-muted-foreground -mt-1">Ausbullen entscheidet üblicherweise, wer eröffnet — einfach den Sieger antippen.</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(teamMode
                ? [0, 1]
                : Array.from({ length: activePlayerCount }, (_, i) => i)
              ).map((i) => {
                const label = teamMode
                  ? (i === 0 ? (teamNames[0].trim() || "Team 1") : (teamNames[1].trim() || "Team 2"))
                  : (playerIsBot[i] ? BOT_PROFILES[playerBotLevel[i]].name : (playerNames[i]?.trim() || `Spieler ${i + 1}`));
                const isChosen = teamMode ? (starterIndex % 2 === i) : starterIndex === i;
                return (
                  <button
                    key={i}
                    onClick={() => setStarterIndex(i)}
                    className={`truncate rounded-lg border px-3 py-2 text-sm font-display transition-colors ${
                      isChosen ? "bg-primary/15 border-primary text-primary" : "bg-background border-border text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
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

          <div className="flex items-center justify-between gap-3 bg-card rounded-lg border border-border px-4 py-3">
            <div className="min-w-0">
              <Label htmlFor="walkon-mode" className="text-sm">Walk-on-Intro</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">Kurze Namens-Einblendung mit Sound vor dem ersten Wurf.</p>
            </div>
            <Switch id="walkon-mode" checked={walkonEnabled} onCheckedChange={setWalkonEnabled} />
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

        <DartScoreInput isDisabled={false} onThrow={submitWarmupDart} />

        <Button onClick={enterMatch} className="w-full mt-4 font-display uppercase text-lg py-6">
          <Target className="w-5 h-5 mr-2" /> Los geht's
        </Button>
      </div>
    );
  }

  // ─── WALK-ON INTRO ──────────────────────────────────
  if (phase === "walkon" && game) {
    const names = game.teams ? game.teams.map((t) => t.name) : game.players.map((p) => p.name);
    const isDuel = names.length === 2;
    return (
      <div
        onClick={() => setPhase(walkonHasStats(game) ? "stats" : "playing")}
        className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center px-6 cursor-pointer overflow-hidden"
      >
        <div className="absolute inset-0 gradient-hero" />
        <p className="relative text-[11px] uppercase tracking-[0.4em] text-muted-foreground mb-6 animate-slide-up">
          Auf die Bühne
        </p>
        {isDuel ? (
          <div className="relative flex flex-col items-center gap-3 w-full max-w-md">
            <h2 className="font-display text-4xl sm:text-5xl uppercase text-primary text-center glow-cyan animate-scale-in truncate max-w-full">
              {names[0]}
            </h2>
            <span className="font-display text-lg text-accent animate-scale-in" style={{ animationDelay: "150ms" }}>VS</span>
            <h2
              className="font-display text-4xl sm:text-5xl uppercase text-secondary text-center glow-green animate-scale-in truncate max-w-full"
              style={{ animationDelay: "300ms" }}
            >
              {names[1]}
            </h2>
          </div>
        ) : (
          <div className="relative flex flex-col items-center gap-2 w-full max-w-md">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Es spielen</p>
            {names.map((name, i) => (
              <h2
                key={i}
                className="font-display text-2xl sm:text-3xl uppercase text-primary text-center glow-cyan animate-scale-in truncate max-w-full"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                {name}
              </h2>
            ))}
          </div>
        )}
        <p className="relative text-[10px] uppercase tracking-widest text-muted-foreground mt-8 animate-slide-up" style={{ animationDelay: "400ms" }}>
          Antippen zum Überspringen
        </p>
      </div>
    );
  }

  // Second walk-on beat, right after the name/VS card — only for a real (non-team) 1v1 where at
  // least one side has club history to show (see walkonHasStats). Big, high-contrast, explicitly
  // labeled per player instead of the easy-to-miss caption this replaced (see commit history):
  // a screen meant to be glanced at from across a table needs numbers you can read at a glance,
  // not a footnote.
  if (phase === "stats" && game) {
    const names = game.players.map((p) => p.name);
    const a = matchClubPlayer(dbPlayers, names[0]);
    const b = matchClubPlayer(dbPlayers, names[1]);
    const statRow = (label: string, value: string) => (
      <div className="flex flex-col items-center">
        <p className="font-display text-3xl sm:text-4xl">{value}</p>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      </div>
    );
    const playerColumn = (name: string, p: ClubPlayer | undefined, nameClass: string) => (
      <div className="flex-1 flex flex-col items-center gap-5 min-w-0">
        <h3 className={`font-display text-lg sm:text-2xl uppercase text-center truncate max-w-full ${nameClass}`}>{name}</h3>
        {p ? (
          <div className="flex flex-col gap-5 w-full items-center">
            {statRow("Average", Number(p.average).toFixed(1))}
            {statRow("Siege", `${p.games_won}/${p.games_played}`)}
            {statRow("Elo", String(Math.round(p.elo_rating)))}
            {statRow("Highscore", String(p.high_score))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-2">Kein Profil</p>
        )}
      </div>
    );
    return (
      <div
        onClick={() => setPhase("playing")}
        className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center px-4 cursor-pointer overflow-hidden"
      >
        <div className="absolute inset-0 gradient-hero" />
        <p className="relative text-[11px] uppercase tracking-[0.4em] text-muted-foreground mb-8 animate-slide-up">
          Statistik-Vergleich
        </p>
        <div className="relative flex items-start justify-center gap-4 sm:gap-10 w-full max-w-lg animate-scale-in">
          {playerColumn(names[0], a, "text-primary glow-cyan")}
          <span className="font-display text-xl text-accent pt-1">VS</span>
          {playerColumn(names[1], b, "text-secondary glow-green")}
        </div>
        {walkonH2H && (
          <div className="relative mt-10 text-center animate-slide-up">
            <p className="font-display text-3xl uppercase text-accent">
              {walkonH2H.total > 0 ? `${walkonH2H.aWins} : ${walkonH2H.bWins}` : "Erstes Mal"}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
              {walkonH2H.total > 0 ? `Bisher gegeneinander · ${walkonH2H.total} Spiele` : "Erstes Aufeinandertreffen"}
            </p>
            {/* Average specifically FROM these head-to-head games — a genuinely different number
                from the lifetime average shown per player above, not a duplicate of it. */}
            {walkonH2H.total > 0 && (
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                Ø im Duell: {walkonH2H.aAvg.toFixed(1)} : {walkonH2H.bAvg.toFixed(1)}
              </p>
            )}
          </div>
        )}
        <p className="relative text-[10px] uppercase tracking-widest text-muted-foreground mt-10 animate-slide-up">
          Antippen zum Start
        </p>
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

  // Scoreboard — extracted so it can render in two different DOM positions depending on mode
  // (see the PLAYING PHASE return below) while staying sticky to whichever region actually
  // scrolls: the page itself in manual mode, or the camera window's own scrollable content area
  // in camera mode. It used to sit OUTSIDE that scrollable area entirely in camera mode (a
  // `shrink-0` flex sibling above it, not sticky within it) — visually indistinguishable from
  // "sticky", but reported as the numbers scrolling separately from the rest of the page, since
  // the camera window itself is a fixed, non-page-scrolling overlay.
  const scoreboardBlock = (
    <div className="sticky top-0 z-30 -mx-4 px-4 pt-3 pb-2 landscape:pt-1.5 landscape:pb-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/40">
      <div className={`grid ${numCols} gap-3 landscape:gap-1.5`}>
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
          // Manual entry: hold the big number at the turn's starting score while darts are
          // still landing (the small "this round" badges below already show what's been hit
          // and the running total) — it only jumps to the true new value once the round ends,
          // which is also the moment scoreFlash briefly highlights it.
          const roundInProgress = isActive && !isCricket && !showPreview && dartsThisRound > 0;
          const displayRemaining = roundInProgress ? turnStartRemaining : previewRemaining;
          const isFlashing = scoreFlash?.slot === card.key;
          return (
            <div key={card.key}
              className={`bg-card rounded-xl p-4 landscape:p-2 border-2 transition-all text-center ${isActive ? "border-primary glow-cyan" : "border-border opacity-80"}`}>
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
                <p className={`text-4xl landscape:text-2xl font-display mt-1 landscape:mt-0 transition-colors ${
                  isFlashing ? "text-accent animate-pulse-glow" : showPreview ? "text-accent" : isActive ? "text-foreground" : "text-muted-foreground"
                }`}>
                  <AnimatedScore value={isCricket ? card.cricketPoints : displayRemaining} />
                </p>
              )}
              {showPreview && (
                <p className="text-[10px] text-muted-foreground -mt-1">
                  ({card.remaining} − {pendingTotal} live)
                </p>
              )}
              {/* min-h reserves this row's space even before the first dart of the round lands —
                  it used to only exist once pendingCameraDarts/activeRound had content, so the
                  card grew taller the instant the first dart registered, shoving everything below
                  (the number pad, mid-tap) down and forcing a scroll. Reserving the space up
                  front keeps the layout stable across the whole round instead of just after it starts. */}
              {isActive && cameraEnabled && (
                <div className="mt-1 flex min-h-6 items-center justify-center gap-1 flex-wrap">
                  {pendingCameraDarts.map((t, idx) => (
                    <span key={idx} className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-display text-accent ring-1 ring-accent/40">
                      {dartLabel(t)}
                    </span>
                  ))}
                </div>
              )}
              {isActive && (
                <div className="mt-1 flex min-h-6 items-center justify-center gap-1 flex-wrap">
                  {activeRound.map((t, idx) => (
                    <span key={idx} className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-display text-primary">
                      {dartLabel(t)}
                    </span>
                  ))}
                  {activeRound.length > 0 && <span className="ml-1 text-[10px] font-display text-accent">+{currentRoundTotal}</span>}
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
        <div className="text-center text-xs landscape:text-[10px] text-muted-foreground mt-2 landscape:mt-1">
          Leg {game.currentLeg.legNumber} · {game.players[game.currentLeg.startingPlayerIndex].name} fängt an
        </div>
      )}

      {/* Current player indicator with dart counter + round score */}
      <div className="text-center mt-2 landscape:mt-1">
        <span className="text-sm text-primary font-medium">
          {currentPlayer?.isBot && botThinking ? `${currentPlayerName} (Bot) wirft…` : `${currentPlayerName} wirft`}
        </span>
        {mode !== "cricket" && !(currentPlayer?.doubleOut ?? true) && (
          <span className="text-[10px] text-muted-foreground ml-2">(Single Out)</span>
        )}
        <div className="flex justify-center gap-1 mt-1 landscape:mt-0.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`w-3 h-3 landscape:w-2 landscape:h-2 rounded-full transition-all ${i < dartsThisRound ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>
        <div className="flex items-center justify-center gap-2 mt-1 landscape:mt-0.5">
          <span className="text-[10px] text-muted-foreground">Dart {dartsThisRound + 1} / 3</span>
          {dartsThisRound > 0 && (
            <span className="text-xs font-display text-primary">+{currentRoundTotal}</span>
          )}
        </div>
      </div>
    </div>
  );

  // ─── PLAYING PHASE ─────────────────────────────────
  return (
    <div className={cameraEnabled
      ? "fixed inset-0 z-40 bg-background flex flex-col animate-slide-up"
      : "container py-4 animate-slide-up max-w-lg mx-auto"}>
      {confettiKey !== null && <ConfettiBurst triggerKey={confettiKey} />}
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
                    { l: "Checkout-Quote", v: (p: typeof postGameStats[number]) => p.checkout.attempts > 0 ? `${p.checkout.hits}/${p.checkout.attempts} (${p.checkout.percentage.toFixed(0)}%)` : "–" },
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
              {tournamentLinkName ? (
                <Button onClick={() => navigate("/tournament")} className="flex-1 font-display uppercase">Zurück zum Turnier</Button>
              ) : (
                <Button onClick={() => { resetGame(); navigate("/game"); }} className="flex-1 font-display uppercase">Neues Spiel</Button>
              )}
            </div>
            {gameSaved && (
              <p className="text-[10px] text-muted-foreground mt-2">
                {queuedOffline ? "⏳ Offline gespeichert — wird synchronisiert, sobald wieder Netz da ist" : "✓ Spiel gespeichert"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Non-camera mode: scoreboard renders here, sticky to the page's own scroll. Camera mode
          renders it inside the scrollable content area below instead (see cameraEnabled branch) —
          see scoreboardBlock's own comment for why. */}
      {!cameraEnabled && scoreboardBlock}

      {pendingTiebreak && (
        <div className="mx-4 mb-3 rounded-lg border-2 border-accent bg-accent/10 p-3 text-center animate-pulse-glow">
          <p className="font-display text-sm uppercase tracking-wide text-accent">Rundenlimit erreicht — Gleichstand</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {pendingTiebreak.tiedIndexes.map((i) => scoreLabels[i]).join(" vs. ")} liegen gleichauf. Wer hat das Ausbullen gewonnen?
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {pendingTiebreak.tiedIndexes.map((i) => (
              <Button key={i} size="sm" onClick={() => resolveTiebreak(i)}>
                {scoreLabels[i]}
              </Button>
            ))}
          </div>
        </div>
      )}

      <ThrowClipDialog
        popup={clipPopup}
        onClose={() => {
          if (clipPopup) URL.revokeObjectURL(clipPopup.url);
          setClipPopup(null);
        }}
      />

      {cameraEnabled ? (
        <>
          {/* The scoreboard now scrolls WITH everything else in this region (sticky to ITS top,
              not fixed above it) — the outer window (and the page behind it) still never scrolls
              while the camera is open, only this one region does. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
            {scoreboardBlock}
            {doubleInBanner}
            {pendingCheckoutChoice && (
              <div className="mb-3 rounded-lg border-2 border-accent bg-accent/10 p-3 text-center animate-pulse-glow">
                <p className="font-display text-sm uppercase tracking-wide text-accent">Mögliches Finish erkannt</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Welcher Dart war der letzte? (Musste ein Doppel sein, sonst überworfen.)
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                  {pendingCheckoutChoice.darts.map((t, idx) => (
                    <span key={idx} className={`rounded px-1.5 py-0.5 text-[10px] font-display ring-1 ${
                      pendingCheckoutChoice.doubleIndexes.includes(idx)
                        ? "bg-accent/20 text-accent ring-accent/40"
                        : "bg-muted text-muted-foreground ring-border"
                    }`}>
                      {dartLabel(t)}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {pendingCheckoutChoice.doubleIndexes.map((idx) => (
                    <Button key={idx} size="sm" onClick={() => resolveCheckoutChoice(idx)} className="gap-1">
                      Fertig mit {dartLabel(pendingCheckoutChoice.darts[idx])}
                    </Button>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => resolveCheckoutChoice("bust")}>
                    Kein Finish – überworfen
                  </Button>
                </div>
              </div>
            )}
            {!isCricket && !currentPlayer?.isBot && !awaitingDoubleIn && (currentPlayer?.doubleOut ?? true) && <div className="mt-3 mb-3"><CheckoutSuggestion remaining={currentRemaining} playerName={currentPlayerName} personalCheckoutRate={checkoutRates[currentPlayerName] ?? null} /></div>}

            {!currentPlayer?.isBot && (
              <LiveCamera
                ref={liveCameraRef}
                enabled={cameraEnabled}
                paused={!!pendingCheckoutChoice || !!pendingTiebreak}
                onClose={() => { cameraWantedRef.current = false; setCameraEnabled(false); setPendingCameraDarts([]); }}
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
              <DartScoreInput isDisabled={game.isFinished || !!currentPlayer?.isBot || !!pendingTiebreak || !!pendingCheckoutChoice}
                onThrow={throwDart}
                onQuickRound={!isCricket && !currentPlayer?.isBot ? handleQuickRound : undefined} />
            )}

            {/* Correcting a mis-tap used to require opening "Manuelle Eingabe" first, then
                finding this section inside it — two collapsed layers deep, easy to miss
                especially while scoring with the camera (this doesn't need the number pad open
                at all, just the ability to review/delete a wrong throw). Now always visible
                whenever there's something to correct, independent of that toggle. */}
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

            <Button variant="ghost" onClick={resetGame} className="w-full mt-3 text-muted-foreground">
              <RotateCcw className="w-4 h-4 mr-2" /> Spiel abbrechen
            </Button>
          </div>

          {/* Compact bottom bar — always reachable, no matter how tall the camera/manual-input content gets. */}
          <div className="shrink-0 border-t border-border bg-background/95 backdrop-blur px-4 py-2.5 flex gap-2">
            <Button variant="outline" onClick={undoLastDart} disabled={undoStack.length === 0 || !!pendingCheckoutChoice || !!pendingTiebreak} className="flex-1 gap-1">
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
              onClick={() => { cameraWantedRef.current = false; setCameraEnabled(false); }}
              className="gap-1"
              title="Kamera schließen"
            >
              <Camera className="w-4 h-4" /> Cam aus
            </Button>
            <Button variant="outline" onClick={() => setSoundEnabled(!soundEnabled)} className="gap-1" title={soundEnabled ? "Sound ausschalten" : "Sound einschalten"} aria-label={soundEnabled ? "Sound ausschalten" : "Sound einschalten"}>
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* Checkout suggestion */}
          {!isCricket && !currentPlayer?.isBot && (currentPlayer?.doubleOut ?? true) && <div className="mt-3 mb-3"><CheckoutSuggestion remaining={currentRemaining} playerName={currentPlayerName} personalCheckoutRate={checkoutRates[currentPlayerName] ?? null} /></div>}

          {/* Cricket scoreboard */}
          {cricketBoard}

          {/* Score input — disabled during a bot's turn */}
          <DartScoreInput isDisabled={game.isFinished || !!currentPlayer?.isBot || !!pendingTiebreak || !!pendingCheckoutChoice}
            onThrow={throwDart}
            onQuickRound={!isCricket && !currentPlayer?.isBot ? handleQuickRound : undefined} />

          {/* Undo & actions row */}
          <div className="flex gap-2 mt-3">
            <Button variant="outline" onClick={undoLastDart} disabled={undoStack.length === 0 || !!pendingCheckoutChoice || !!pendingTiebreak} className="flex-1 gap-1">
              <Undo2 className="w-4 h-4" /> Rückgängig
            </Button>
            <Button
              variant="outline"
              onClick={() => { cameraWantedRef.current = true; setCameraEnabled(true); }}
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
                              t.multiplier === 3 ? "bg-primary/20 text-primary" :
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
