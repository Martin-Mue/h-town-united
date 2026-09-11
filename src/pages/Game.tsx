import { useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { RotateCcw, Trophy, Target, Edit2, X, Users, Undo2, Volume2, VolumeX, Camera, Mic, MicOff, Bot, Plus, Minus, Keyboard, ChevronUp, ChevronDown, Share2, Settings2, WifiOff, Sparkles, Lock } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import DartScoreInput, { type DartInputMode } from "@/components/game/DartScoreInput";
import GameSetup from "@/components/game/GameSetup";
import GameWarmup from "@/components/game/GameWarmup";
import { GameWalkonIntro, GameWalkonStats } from "@/components/game/GameWalkon";
import GamePostGame from "@/components/game/GamePostGame";
import ThrowHistoryEditor from "@/components/game/ThrowHistoryEditor";
import CheckoutSuggestion from "@/components/game/CheckoutSuggestion";
// Loaded lazily — LiveCamera pulls in onnxruntime-web + vision utilities (~112KB) that a keyboard-
// only match (or any bot game, which never renders this at all — see the !currentPlayer?.isBot
// guard below) has no use for. Type-only imports are erased at compile time, so they don't defeat
// the code-split the way a value import of the same module would.
const LiveCamera = lazy(() => import("@/components/game/LiveCamera"));
import type { DetectedDart, LiveCameraHandle } from "@/components/game/LiveCamera";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import ThrowClipDialog, { type ThrowClipPopup } from "@/components/game/ThrowClipDialog";
import OnlineChallengeSetup from "@/components/game/OnlineChallengeSetup";
import ConfettiBurst from "@/components/ConfettiBurst";
import AiMatchReport from "@/components/game/AiMatchReport";
import AnimatedScore from "@/components/AnimatedScore";
import type { GameMode, GameState, LegState, DartThrow, CricketPlayerState, PlayerSlot, TeamSlot, BotLevel } from "@/types/game";
import { CRICKET_NUMBERS } from "@/types/game";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { recordMatchResult, pushLiveSnapshot } from "@/lib/tournamentMatchSync";
import { applyLeagueFixtureResult } from "@/lib/leagueFixtureSync";
import { loadActiveGameSnapshot, saveActiveGameSnapshot, clearActiveGameSnapshot } from "@/lib/activeGameSnapshot";
import { useTournamentLink } from "@/hooks/useTournamentLink";
import { useLeagueLink } from "@/hooks/useLeagueLink";
import { useOnlineMatch } from "@/hooks/useOnlineMatch";
import { computePostGameStats } from "@/utils/postGameStats";
import { isBustThrow, isQualifyingDouble as qualifyingDouble, resolveX01Visit, pointsFor, dartLabel } from "@/utils/x01Rules";
import { simulateBotVisit, simulateBotCricketDart, configForAverage, rollConfigForLevel, BOT_LEVEL_RANGES, type LevelConfig } from "@/utils/botPlayer";
import {
  average as calculateAverage,
  count180s,
  computeCheckoutStats,
  combineCheckoutStats,
  checkoutDoubleBreakdown,
  combineCheckoutDoubleBreakdowns,
  isAchievableVisitTotal,
  segmentCount,
  SEGMENT_NUMBERS,
  type StatBundle,
  type CheckoutDoubleBreakdown,
} from "@/utils/dartStats";

/** Bot personas with their target 3-dart average range. `nameKey` (not a literal string) since
 *  this is a module-level constant with no access to the language context — resolved via t() at
 *  each call site instead. `average` is derived from botPlayer.ts's own BOT_LEVEL_RANGES rather
 *  than a second hand-typed copy of the same numbers — this exact pair silently drifted out of
 *  sync once already (the picker kept showing 25–30/45–50/68–75/88–95/140+ long after the actual
 *  ranges were retuned to 30-40/40-50/50-60/60-80/80-100, since nothing tied this label to the
 *  real source of truth), which is precisely the class of bug deriving it removes for good. */
const botRangeLabel = (level: BotLevel): string => {
  const [min, max] = BOT_LEVEL_RANGES[level];
  return `${min}–${max}`;
};
export const BOT_PROFILES: Record<BotLevel, { nameKey: string; average: string }> = {
  easy: { nameKey: "game.botLv1", average: botRangeLabel("easy") },
  medium: { nameKey: "game.botLv2", average: botRangeLabel("medium") },
  hard: { nameKey: "game.botLv3", average: botRangeLabel("hard") },
  elite: { nameKey: "game.botLv4", average: botRangeLabel("elite") },
  legendary: { nameKey: "game.botLv5", average: botRangeLabel("legendary") },
};
import {
  playThrowSound, playBustSound, play180Sound, playCheckoutSound,
  playVictorySound, playTonPlusSound, playTurnSwitchSound, playWalkonSound,
} from "@/utils/sounds";
import { speakSequence, speakText, buildRoundAnnouncement, getCallerVoice, setCallerVoice, type CallerVoice } from "@/utils/speech";
import { shareOrDownloadResultImage } from "@/utils/shareResultImage";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { clubHasFeature } from "@/lib/planFeatures";
import { fetchLiveCommentary, getAiCommentaryEnabled, setAiCommentaryEnabled as persistAiCommentaryEnabled, type CommentaryEvent } from "@/lib/aiCommentary";
import { Eyebrow, SectionCard } from "@/components/stats/StatPrimitives";
import { teamIndexFor } from "@/utils/teamUtils";
import { effectiveStartScore } from "@/utils/handicap";
import { createLegState, createCricketState } from "@/utils/gameStateFactory";
import { applyLegWin, applyCricketDart, replayCricketState, generateRandomCricketNumbers, wouldWinMatch } from "@/utils/legLogic";
import { resolveRoundCap, type RoundCapOutcome } from "@/utils/roundCap";
import { saveGameRecord } from "@/lib/gameSync";
import { enqueueGameSave, enqueueMatchResult, enqueueLeagueFixtureResult } from "@/lib/offlineQueue";
import { matchClubPlayer, type ClubPlayer } from "@/lib/repositories/players";
import { verifyPin } from "@/lib/playerPin";
import { usePlayers } from "@/hooks/usePlayers";
import { isLiveSnapshotFresh, totalRoundsOf, type Match, type RoundRobinMatch } from "@/utils/tournament";
import { ghostRemainingSequence, compareToGhost } from "@/utils/ghostMode";
import { buildRivalryStoryline } from "@/utils/rivalryStoryline";

const WALKON_PREF_KEY = "dart-walkon-enabled";
const INPUT_MODE_PREF_KEY = "dart-input-mode";
const SOUND_PREF_KEY = "dart-sound-enabled";
/** Progressive disclosure (Design Rangliste #16): a brand-new member and a club veteran saw the
 *  exact same fully-expanded setup form — round-limit, custom-Cricket, and per-player
 *  double-in/double-out/handicap are real options but not ones a first-time player needs to think
 *  about before their first throw. Collapsed by default; the very first time anyone actually opens
 *  it, that "I use this" signal is remembered per-device so it stays open for them from then on —
 *  nobody has to re-expand it every single game once they've shown they care about it. */
const ADVANCED_SETUP_SEEN_KEY = "dart-advanced-setup-seen";
/** How long the walk-on intro stays up before auto-advancing (ms) — also the window
 *  during which a tap skips straight to the match. */
const WALKON_DURATION_MS = 3200;
/** How long the follow-up stat-comparison screen stays up (ms) — longer than the walk-on
 *  card itself since there's actually something to read this time. */
const STATS_DURATION_MS = 4500;
/** How long a board-mode match's confirmation screen counts down before auto-starting (ms) —
 *  longer than the walk-on/stats beats above since this actually commits to starting a real
 *  match, not just skipping a cosmetic intro; "Bearbeiten" cancels it at any point. */
const AUTOSTART_DELAY_MS = 5000;
export const MAX_PLAYERS = 8;

// createLegState/createCricketState moved to utils/gameStateFactory.ts (imported above) so the
// online-match accept flow can build a real starting leg without duplicating this logic.
// applyLegWin/applyCricketDart/replayCricketState/generateRandomCricketNumbers moved to
// utils/legLogic.ts (Round 3 Rang 12 — see that file's own doc comment) — they were already pure,
// closing over nothing but their own parameters, so this is a behavior-neutral extraction.

/** Undo snapshot for reverting last dart */
interface UndoSnapshot {
  game: GameState;
  dartsThisRound: number;
  turnStartRemaining: number;
}

const DEFAULT_NAMES = Array.from({ length: MAX_PLAYERS }, (_, i) => `Spieler ${i + 1}`);

const GamePage = () => {
  // Read exactly once (on mount) — every piece of state a crash-recovery restore touches
  // (phase, game, dartsThisRound, turnStartRemaining, the tournament link) seeds from this same
  // snapshot below, rather than each independently re-reading localStorage.
  const [initialSnapshot] = useState(() => loadActiveGameSnapshot());
  const [phase, setPhase] = useState<"setup" | "warmup" | "walkon" | "stats" | "playing" | "postGame">(() =>
    initialSnapshot ? "playing" : "setup"
  );
  const [mode, setMode] = useState<GameMode>("501");
  const [bestOfLegs, setBestOfLegs] = useState(3);
  // Sets-Modus (Runde 5): "Best of X Sätze, je Satz Best of Y Legs" — the standard professional
  // darts match structure, layered on top of the plain leg race above rather than replacing it
  // (bestOfLegs becomes "legs per set" the moment this is on; see GameState.setsMode's own doc
  // comment). Off by default — a flat best-of-legs match is still the common case for casual play.
  const [setsEnabled, setSetsEnabled] = useState(false);
  const [bestOfSets, setBestOfSets] = useState(3);
  const [maxRoundsX01, setMaxRoundsX01] = useState<number>(0); // 0 = unlimited
  const [customStartScore, setCustomStartScore] = useState(501);
  const [numPlayers, setNumPlayers] = useState(2);
  const [customCricket, setCustomCricket] = useState(false);
  const [teamMode, setTeamMode] = useState(false);
  // Toggle shown on the plain (not tournament/league-linked) setup screen — "online" swaps the
  // whole form for OnlineChallengeSetup (challenge a real club member, synced two-device play)
  // instead of the usual local player-name entry. Not persisted; always starts on "local".
  const [setupMode, setSetupMode] = useState<"local" | "online">("local");
  // Who throws first in the match — a raw player index normally, but effectively a team choice
  // in team mode (0/1 pick each team's first member, matching the [TeamA-1, TeamB-1, TeamA-2,
  // TeamB-2, ...] interleaving createLegState/teamIndexFor already assume). Defaults to 0 (today's
  // fixed "player 1 starts"); the "Ausbullen" picker in setup just lets the group record who
  // actually won the bull-off instead.
  const [starterIndex, setStarterIndex] = useState(0);
  const [teamNames, setTeamNames] = useState<[string, string]>(["Team 1", "Team 2"]);
  const [playerNames, setPlayerNames] = useState<string[]>([...DEFAULT_NAMES]);
  // "PIN pro Spieler": which roster slot is waiting on a PIN, and for which club member — see
  // the roster-picker button in the setup form and submitPinPrompt below. Verification is fully
  // client-side against that player's stored hash+salt (@/lib/playerPin), so it works offline.
  const [pinPrompt, setPinPrompt] = useState<{ slotIndex: number; player: ClubPlayer } | null>(null);
  const [pinPromptValue, setPinPromptValue] = useState("");
  const [pinPromptError, setPinPromptError] = useState(false);
  const [pinPromptChecking, setPinPromptChecking] = useState(false);
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
  const [soundEnabled, setSoundEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(SOUND_PREF_KEY);
    return raw ? raw !== "false" : true;
  });
  const [callerVoice, setCallerVoiceState] = useState<CallerVoice>(() => getCallerVoice());
  // Derived, not its own state — "off" is now just the caller-voice picker's 4th option instead
  // of a separate Switch, so every existing `if (speechEnabled)` gate below keeps working
  // unchanged off of this one source of truth.
  const speechEnabled = callerVoice !== "off";
  const changeCallerVoice = (v: CallerVoice) => {
    setCallerVoice(v);
    setCallerVoiceState(v);
  };
  // Live-KI-Kommentator (2026-09-10) — personal opt-in on top of the club's plan-tier gate (see
  // the toggle button's own comment further down for why both checks exist).
  const [aiCommentaryEnabled, setAiCommentaryEnabledState] = useState(() => getAiCommentaryEnabled());
  const toggleAiCommentary = () => {
    const next = !aiCommentaryEnabled;
    persistAiCommentaryEnabled(next);
    setAiCommentaryEnabledState(next);
  };
  const [walkonEnabled, setWalkonEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    const raw = window.localStorage.getItem(WALKON_PREF_KEY);
    return raw ? raw !== "false" : true;
  });
  const [showAdvancedSetup, setShowAdvancedSetup] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(ADVANCED_SETUP_SEEN_KEY) === "1";
  });
  const revealAdvancedSetup = () => {
    setShowAdvancedSetup((prev) => {
      const next = !prev;
      // Only the transition to OPEN counts as "this person uses advanced settings" — collapsing it
      // back again afterwards (e.g. to declutter before naming players) doesn't un-graduate them.
      if (next && typeof window !== "undefined") window.localStorage.setItem(ADVANCED_SETUP_SEEN_KEY, "1");
      return next;
    });
  };
  // Which of the 3 dart-entry modes (per-dart pad / quick-total grid / typed total) the scoring
  // pad shows — persisted (not just component-local state) and switchable mid-game, deliberately
  // shared across every DartScoreInput on this screen so choosing it once covers the whole match.
  const [dartInputMode, setDartInputMode] = useState<DartInputMode>(() => {
    if (typeof window === "undefined") return "single";
    const raw = window.localStorage.getItem(INPUT_MODE_PREF_KEY);
    return raw === "quick" || raw === "total" ? raw : "single";
  });
  // Ghost mode lives as a 4th bot "level" (see the per-player bot picker) rather than a separate
  // toggle — a Geist-bot opponent that plays roughly the target's pace, with the human's live
  // progress compared against it turn by turn. Index-aligned with players; only meaningful for a
  // player marked isBot with botLevel effectively "ghost" (tracked here rather than in BotLevel
  // itself, to avoid touching that type everywhere it's exhaustively handled elsewhere).
  // "own-pb" races the HUMAN opponent's own best-ever leg at this start score — the only target
  // Ghost mode offers (a named dart-count benchmark option used to exist alongside it, removed
  // 2026-08-23: one less choice to make, Ghost now always just means "beat yourself").
  const [playerGhostTarget, setPlayerGhostTarget] = useState<("off" | "own-pb")[]>(Array(MAX_PLAYERS).fill("off"));
  // Index-aligned with players — each entry is what THAT player is racing against (their live
  // pace compared to it turn by turn), not what they themselves embody. For a Geist-bot's human
  // opponent, this is the bot's target sequence; the bot's own slot stays null (no comparison
  // shown on a bot's own, non-rendered turn). null = no ghost assigned, or a past leg wasn't found.
  const [ghostSequences, setGhostSequences] = useState<(number[] | null)[]>([]);
  const [game, setGame] = useState<GameState | null>(() => initialSnapshot?.game ?? null);
  // Fallback defaults for handleX01Throw/handleCricketThrow when called without an explicit
  // dart (bot logic, camera detection) — DartScoreInput's buttons always pass explicit values.
  const selectedScore = 20;
  const multiplier = 1;
  const [editingThrowIdx, setEditingThrowIdx] = useState<number | null>(null);
  /** Which specific dart (by its flat index into that player's throws array) currently has its
   *  value-edit popover open — separate from editingThrowIdx above, which is just the "edit mode
   *  is on for this history card at all" toggle. */
  const [editingChipIdx, setEditingChipIdx] = useState<number | null>(null);
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [sharingResult, setSharingResult] = useState(false);
  const [gameSaved, setGameSaved] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const { name: clubName, clubId, club } = useClubBranding();
  const [searchParams] = useSearchParams();
  // Declared up here (rather than alongside their other in-game-HUD state further down) because
  // the crash-recovery save effect just below needs them in its dependency array, which is
  // evaluated eagerly on every render — unlike a closure body, that array literal genuinely
  // can't reference a const declared later in the same component function.
  const [dartsThisRound, setDartsThisRound] = useState(() => initialSnapshot?.dartsThisRound ?? 0);
  const [turnStartRemaining, setTurnStartRemaining] = useState<number>(() => initialSnapshot?.turnStartRemaining ?? 0);
  // Computed once at mount (before any reset/finish can clear the snapshot) — whether this
  // page load recovered an in-progress game rather than starting fresh at "setup".
  const restoredFromSnapshotRef = useRef(phase === "playing" && !!game);
  useEffect(() => {
    if (restoredFromSnapshotRef.current) {
      toast({ title: t("game.gameRestored"), description: t("game.gameRestoredDesc") });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Clearing used to happen here, in its own effect keyed only on isFinished — which fires (and
  // React runs effects in declaration order, so this ran) BEFORE saveGame's own isFinished effect
  // even starts its several-awaited-calls-deep save. If a PWA update's location.reload() landed in
  // that window, the crash-recovery copy was already gone and the pending save was torn down
  // mid-flight with no trace anywhere — a finished match lost outright. Moved into saveGame()
  // itself now, cleared only once the game is durably somewhere (Supabase, or the offline queue on
  // failure) — see the end of that function.
  /** Whether the CheckoutSuggestion card shows during play. Defaults off for a tournament match
   *  (competitive play shouldn't hint the route) and on otherwise, but stays freely toggleable
   *  either way — this is a default, not a lock, unlike the fields the bracket actually fixes.
   *  Not persisted to localStorage on purpose: a per-preference key would leak a tournament
   *  override into the next casual game's default (or vice versa) instead of each context
   *  re-deriving its own sensible default every time. Seeded from initialSnapshot here so a
   *  crash-recovery resume of a tournament match (which skips "setup" entirely) still gets the
   *  right default; the fresh-launch path sets it again in the tid/mid prefill effect below. */
  const [checkoutSuggestionEnabled, setCheckoutSuggestionEnabled] = useState(() => !initialSnapshot?.tournamentLink);
  const { tournamentLinkRef, tournamentLinkName, setTournamentLinkName } = useTournamentLink({
    searchParams,
    initialTournamentLink: initialSnapshot?.tournamentLink ?? null,
    setPlayerNames,
    setTeamMode,
    setNumPlayers,
    setMode,
    setBestOfLegs,
    setCheckoutSuggestionEnabled,
    setSetsEnabled,
    setBestOfSets,
  });
  const { leagueLinkRef } = useLeagueLink({ searchParams, setPlayerNames, setTeamMode, setNumPlayers, setMode, setBestOfLegs });
  // Online-match play (?online=<online_matches.id>) — a THIRD entry path alongside the two above.
  // The actual sync effects live further down (after pendingGameIdRef exists), see there.
  const onlineMatchId = searchParams.get("online");
  const onlineMatch = useOnlineMatch(onlineMatchId ?? undefined, session?.user?.id);
  // Mirror the in-progress game to localStorage on every change — see loadActiveGameSnapshot's
  // doc comment. Cleared once the leg is decided (below) or on an explicit new-game reset
  // (resetGame), since a finished game's durability is the existing save/offline-queue path's
  // job, not this snapshot's.
  useEffect(() => {
    if (phase === "playing" && game && !game.isFinished) {
      saveActiveGameSnapshot({ game, dartsThisRound, turnStartRemaining, tournamentLink: tournamentLinkRef.current });
    }
    // dartsThisRound/turnStartRemaining included deliberately — without them a snapshot taken
    // mid-visit (after game changed but before either was re-derived) could be saved with stale
    // values. tournamentLinkRef's own identity never changes (a ref, now returned from
    // useTournamentLink instead of a bare useRef() call, but still just a ref) — listed only to
    // satisfy the lint rule, which can no longer see that stability across the hook boundary.
  }, [game, phase, dartsThisRound, turnStartRemaining, tournamentLinkRef]);
  // Board-mode auto-start: a board-linked match counts down to starting itself instead of
  // waiting for a tap on "Spiel starten" — "Bearbeiten" (below) cancels it for the rare case
  // something (handicap, warmup, ...) needs adjusting first. Not persisted in the crash-recovery
  // snapshot on purpose — a reload mid-countdown should re-show the confirmation, not silently
  // resume counting down toward starting a match nobody's looking at yet.
  const [autoStartCanceled, setAutoStartCanceled] = useState(false);
  const [autoStartSecondsLeft, setAutoStartSecondsLeft] = useState(0);
  // Board mode used to auto-start regardless of whether this round was marked "Extern" or
  // live play was switched off tournament-wide, and regardless of whether another device already
  // had a fresher live snapshot running for the exact same match — both cases the manual "Spiel
  // starten" button already guards against (canStartLiveGame / isLiveSnapshotFresh in
  // Tournament.tsx). "checking" until the one-time lookup below resolves; the auto-start effect
  // only ever arms while this is "clear".
  const [boardStartGate, setBoardStartGate] = useState<"checking" | "clear" | "blocked-mode" | "blocked-collision">("checking");
  const savingRef = useRef(false);
  // Mirrors game.currentLeg.remaining, updated synchronously the instant a throw is processed —
  // not just on the next render. handleX01Throw reads from this instead of the `game` closure
  // specifically so two throws landing before React re-renders (a fast double-tap on two number
  // buttons, or a touchscreen double-touch) each see the OTHER's update instead of both computing
  // from the same stale remaining value and one silently clobbering the other's subtraction.
  const remainingRef = useRef<number[]>([]);
  // Round 3 Rang 4: shared/cached club roster (usePlayers) instead of this component's own
  // fetchClubPlayers() mount effect — see usePlayers.ts. Defaults to [] while loading, same as
  // the old useState did.
  const { data: dbPlayers = [] } = usePlayers();
  // Head-to-head record for the walk-on screen — null while unresolved (no fetch fired yet,
  // or one of the two isn't a real roster player), { total: 0, ... } once fetched but this is
  // their first-ever meeting. Fetched once per game start (see startGame), not derived from
  // dbPlayers, since it needs the actual `games` history, not just roster totals. aAvg/bAvg are
  // each side's average SPECIFICALLY across these head-to-head games — deliberately separate
  // from their lifetime average (already shown from dbPlayers), since how someone plays against
  // this one specific opponent is its own, genuinely different number.
  const [walkonH2H, setWalkonH2H] = useState<{ aWins: number; bWins: number; total: number; aAvg: number; bAvg: number; storyline: string | null; aWinProb: number | null } | null>(null);
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
  // "Cancel Game" wipes an in-progress match outright — every other destructive action in the
  // app (delete player, delete tournament, withdraw, reset a KO match) confirms first, this one
  // didn't. Shared by both the camera-on and camera-off layouts below (mutually exclusive
  // branches of the same render), one dialog instead of two copies.
  const [confirmCancelGame, setConfirmCancelGame] = useState(false);
  // Generated up front (before the game row exists) so highlight clips captured
  // mid-game can already reference the game they'll end up saved under.
  const pendingGameIdRef = useRef<string>(crypto.randomUUID());

  // --- Online-match sync (see the onlineMatch = useOnlineMatch(...) call further up) ---
  // True once this device has applied the online match's state at least once — gates the
  // outgoing-sync effect below so it can never fire on a stale/half-initialized `game` before the
  // real online state has landed.
  const onlineInitializedRef = useRef(false);
  // Set right before applying an INCOMING remote update to local state, and checked (then reset)
  // by the outgoing-sync effect immediately after — without this, applying the opponent's throw
  // would itself change `game`, which would re-trigger the outgoing effect and try to "sync back"
  // a state that already came FROM the server, an unnecessary echo. Not a correctness issue
  // either way (submit_online_throw's own turn-check would just reject an echo that isn't
  // actually this device's turn), but avoids the wasted round-trip.
  const applyingRemoteOnlineUpdateRef = useRef(false);

  // Applies the online match's current state to local game/dartsThisRound/turnStartRemaining —
  // fires on first load (transitions phase straight to "playing", skipping setup/warmup/walkon
  // entirely for online mode) AND on every subsequent update (the opponent's next throw arriving
  // via useOnlineMatch's broadcast/postgres_changes subscriptions).
  useEffect(() => {
    if (!onlineMatchId) return;
    const state = onlineMatch.row?.game_state;
    if (onlineMatch.row?.status !== "active" || !state) return;
    if (!onlineInitializedRef.current) {
      onlineInitializedRef.current = true;
      // Shared, deterministic id (not a fresh crypto.randomUUID() like a local startGame() would
      // generate) — both devices independently reach game.isFinished and call saveGame(); this is
      // what makes gameSync.ts's existing pendingGameId-existence check actually catch that as one
      // duplicate save attempt instead of two genuinely different games.
      pendingGameIdRef.current = onlineMatchId;
      setPhase("playing");
    }
    applyingRemoteOnlineUpdateRef.current = true;
    const { dartsThisRound: incomingDarts, turnStartRemaining: incomingTurnStart, ...gameOnly } = state;
    setGame(gameOnly);
    setDartsThisRound(incomingDarts);
    setTurnStartRemaining(incomingTurnStart);
  }, [onlineMatchId, onlineMatch.row]);

  // Propagates a throw THIS device just applied locally out to the opponent's device — mirrors
  // the existing crash-recovery snapshot effect (a bit further down) in shape (watch game/
  // dartsThisRound/turnStartRemaining, act on every change) but targets the shared online-match
  // row instead of localStorage.
  useEffect(() => {
    if (!onlineMatchId || !onlineInitializedRef.current || !game || phase !== "playing") return;
    if (applyingRemoteOnlineUpdateRef.current) { applyingRemoteOnlineUpdateRef.current = false; return; }
    void onlineMatch.sendThrow(game, dartsThisRound, turnStartRemaining).catch((err) => {
      console.error("online throw sync failed", err);
      toast({ title: t("game.onlineSyncFailedTitle"), description: t("game.onlineSyncFailedDesc"), variant: "destructive" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, dartsThisRound, turnStartRemaining, phase, onlineMatchId]);

  // A league-fixture-sourced online match (see League.tsx's startFixtureOnline) reaches Game.tsx
  // via ?online=<id> alone, never the lid/fid/p1id/p2id params useLeagueLink reads — the accepting
  // device in particular has no way to know those, since PendingOnlineChallenges.tsx navigates it
  // in generically with no fixture knowledge at all. Resolving the fixture here and populating the
  // SAME leagueLinkRef lets the existing league_fixtures write-back (further below) fire unchanged
  // on either device. player1Id/player2Id stay the fixture's OWN stored ids (unlike local play,
  // NOT guaranteed to line up with GameState.players[0]/[1] — whoever taps "Online" first becomes
  // GameState slot 0, which may be either fixture participant) — player1IsGameSlot0 records which
  // way round it landed so the write-back can attribute legsWon/winner_id correctly either way.
  useEffect(() => {
    const row = onlineMatch.row;
    if (!row || row.source_type !== "league" || !row.source_id || leagueLinkRef.current) return;
    let cancelled = false;
    (async () => {
      const { data: fixture } = await supabase.from("league_fixtures")
        .select("league_id, player1_id, player2_id").eq("id", row.source_id!).maybeSingle();
      if (cancelled || !fixture) return;
      const { data: fixtureP1Row } = await supabase.from("players")
        .select("user_id").eq("id", fixture.player1_id).maybeSingle();
      if (cancelled || !fixtureP1Row) return;
      leagueLinkRef.current = {
        leagueId: fixture.league_id,
        fixtureId: row.source_id!,
        player1Id: fixture.player1_id,
        player2Id: fixture.player2_id,
        player1IsGameSlot0: fixtureP1Row.user_id === row.player1_user_id,
      };
    })();
    return () => { cancelled = true; };
  }, [onlineMatch.row, leagueLinkRef]);

  // Same idea as the league effect just above, for a tournament-bracket-match-sourced online
  // match (see Tournament.tsx's startMatchOnline) — source_id is "tournamentId:matchId". Sets
  // BOTH tournamentLinkRef (read directly by the pushLiveSnapshot/write-back effects) AND
  // tournamentLinkName (state — unlike leagueLinkRef, several render sites below, e.g. the
  // post-game Rematch/"Back to Tournament" buttons, key off this STATE rather than the ref).
  // Tournament brackets store players as free NAME strings, not ids (see the plan's own
  // documented finding) — player1Name/player2Name/player1IsGameSlot0 let the write-back attribute
  // the result to the right bracket slot without trusting GameState.winnerName/legsWon order
  // directly, the same class of fix as the league case.
  useEffect(() => {
    const row = onlineMatch.row;
    if (!row || row.source_type !== "tournament" || !row.source_id || tournamentLinkRef.current) return;
    const [tournamentId, matchId] = row.source_id.split(":");
    if (!tournamentId || !matchId) return;
    let cancelled = false;
    (async () => {
      const { data: tournament } = await supabase.from("tournaments")
        .select("name, bracket").eq("id", tournamentId).maybeSingle();
      if (cancelled || !tournament) return;
      const bracket = (tournament.bracket as unknown as (Match | RoundRobinMatch)[]) || [];
      const match = bracket.find((m) => m.id === matchId);
      if (!match?.player1 || !match?.player2) return;
      // Round 3 Rang 4: reads the shared usePlayers() roster (dbPlayers) instead of issuing its
      // own fetchClubPlayers() call — dbPlayers is in the dependency array below so this effect
      // retries once the roster has actually loaded, instead of only ever seeing an empty roster
      // if it happened to run before the shared query resolved.
      const p1 = matchClubPlayer(dbPlayers, match.player1);
      if (!p1?.user_id) return;
      tournamentLinkRef.current = {
        tournamentId, matchId, tournamentName: tournament.name,
        player1Name: match.player1, player2Name: match.player2,
        player1IsGameSlot0: p1.user_id === row.player1_user_id,
      };
      setTournamentLinkName(tournament.name || "Turnier");
    })();
    return () => { cancelled = true; };
  }, [onlineMatch.row, tournamentLinkRef, setTournamentLinkName, dbPlayers]);

  const [botThinking, setBotThinking] = useState(false);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const botPlanRef = useRef<{ key: string; darts: DartThrow[]; applied: number } | null>(null);
  // A rolled-per-leg bot config, keyed by "${playerIndex}-${legNumber}" — see rollConfigForLevel's
  // doc comment for why this exists (a real opponent doesn't play the exact same average every
  // leg). Never explicitly cleared between legs (a new leg number is simply a cache miss, which
  // rolls its own fresh entry) — only reset on a genuinely new game, same as botPlanRef.
  const botLegConfigRef = useRef<Record<string, LevelConfig>>({});
  const [checkoutRates, setCheckoutRates] = useState<Record<string, number>>({});
  // Round 3 Rang 16: per-player, per-double hit rates (e.g. "your D16 rate") alongside the flat
  // overall checkoutRates above — see CheckoutSuggestion.tsx's personalDoubleBreakdown prop doc
  // comment for why this is the more genuinely "personalized" of the two. Fetched in the exact
  // same effect/query as checkoutRates below (same game_legs rows, no extra round trip).
  const [checkoutDoubleRates, setCheckoutDoubleRates] = useState<Record<string, CheckoutDoubleBreakdown[]>>({});
  // Mirrors checkoutRates for the "already fetched this player" guard below — read via the ref
  // (not the checkoutRates closure) specifically so that effect doesn't need checkoutRates in its
  // own dependency array, which would re-fire it every time ANY player's rate gets cached, not
  // just when the active player/mode actually changes.
  const checkoutRatesRef = useRef(checkoutRates);
  checkoutRatesRef.current = checkoutRates;
  // Briefly highlights a score slot's remaining number right when a round finishes (checkout,
  // bust, 3rd dart, or a committed camera round) — { slot, key } so re-triggering the same
  // slot twice in a row (e.g. two rounds without anyone else throwing) still re-plays the pulse.
  const [scoreFlash, setScoreFlash] = useState<{ slot: number; key: number } | null>(null);
  const flashScore = (slot: number) => {
    setScoreFlash((prev) => ({ slot, key: (prev?.key ?? 0) + 1 }));
    window.setTimeout(() => setScoreFlash((prev) => (prev?.slot === slot ? null : prev)), 900);
  };

  // Defaults player slot 1 to whoever's actually logged in (once their own claimed club profile
  // — players.user_id — is known), so starting a casual game doesn't require re-picking yourself
  // from the club-member popover every time. Skipped outright for a tournament-match launch,
  // which always carries its own two named players via the prefill effect below and must win
  // unconditionally — and only fires while slot 1 is still the untouched "Spieler 1" placeholder,
  // so it can never clobber a name the user (or that same prefill effect) already set.
  useEffect(() => {
    if (searchParams.get("tid")) return;
    const myId = session?.user?.id;
    if (!myId || dbPlayers.length === 0) return;
    const me = dbPlayers.find((p) => p.user_id === myId);
    if (!me) return;
    setPlayerNames((prev) => (prev[0] === DEFAULT_NAMES[0] ? [me.name, ...prev.slice(1)] : prev));
    // searchParams is intentionally excluded — this is a one-time default-fill the moment both
    // the session and club roster are known, not something that should re-run on every
    // navigation-driven searchParams identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, dbPlayers]);

  // Board-mode start gate: resolves whether THIS match may actually auto-start, mirroring
  // Tournament.tsx's canStartLiveGame (live_play_enabled + per-round "Extern") plus the same
  // isLiveSnapshotFresh collision check the manual "Spiel starten" button already guards with —
  // board mode's auto-start previously skipped both, so a round marked "Extern" (or a
  // live-play-disabled tournament) could still auto-start here, and two devices bound to the same
  // board could both auto-start the same match with no human checkpoint at all. Only relevant
  // when this launch came from board mode (tournamentLinkRef.current?.board is set); runs once
  // per tournament-linked mount, keyed off tournamentLinkName the same way the prefill effect
  // above sets it.
  useEffect(() => {
    const link = tournamentLinkRef.current;
    if (!link?.board) return;
    let cancelled = false;
    setBoardStartGate("checking");
    (async () => {
      const { data } = await supabase
        .from("tournaments")
        .select("bracket, mode, live_play_enabled, round_configs, game_mode, best_of_legs")
        .eq("id", link.tournamentId)
        .maybeSingle();
      if (cancelled) return;
      if (!data || !(data.live_play_enabled ?? true)) { setBoardStartGate("blocked-mode"); return; }
      const bracket = ((data.bracket as unknown as Match[]) || []);
      const match = bracket.find((m) => m.id === link.matchId);
      if (!match) { setBoardStartGate("blocked-mode"); return; }
      // Same round_configs[totalRounds]-for-round-0 convention as Tournament.tsx's
      // resolveRoundMode/roundConfigIndex.
      const cfgIndex = match.round === 0 ? totalRoundsOf(bracket) : match.round - 1;
      const cfg = ((data.round_configs as unknown as { mode?: string; bestOf?: number }[]) || [])[cfgIndex];
      const roundMode = cfg?.mode || data.game_mode || "501";
      if (roundMode === "Extern") { setBoardStartGate("blocked-mode"); return; }
      if (isLiveSnapshotFresh(match.live)) { setBoardStartGate("blocked-collision"); return; }
      setBoardStartGate("clear");
    })();
    return () => { cancelled = true; };
    // tournamentLinkRef's identity never changes (see the snapshot-mirroring effect above for why
    // it's listed at all despite that).
  }, [tournamentLinkName, tournamentLinkRef]);

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
    // Deliberately depends on these specific fields, not `game` itself — adding the whole object
    // would re-arm the debounce timer on every dart thrown (game's identity changes on ANY
    // update, including fields this push doesn't care about, e.g. currentPlayerIndex/throws),
    // defeating the "wait for scoring to settle" point of debouncing in the first place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.currentLeg.remaining, game?.legsWon, game?.isFinished, game?.mode, phase]);

  // Fetches the current player's career checkout conversion rate on demand (once per
  // player per session) so CheckoutSuggestion can show "how often do I actually convert this".
  useEffect(() => {
    if (!game || game.mode === "cricket" || phase !== "playing") return;
    const player = game.players[game.currentPlayerIndex];
    if (!player || player.isBot || checkoutRatesRef.current[player.name] !== undefined) return;
    const match = dbPlayers.find((p) => p.name === player.name);
    if (!match) return;
    supabase
      .from("game_legs")
      .select("throws, starting_score")
      .eq("player_id", match.id)
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        const combined = combineCheckoutStats(
          data.map((leg) => computeCheckoutStats(leg.throws as unknown as DartThrow[], leg.starting_score))
        );
        if (combined.attempts > 0) setCheckoutRates((prev) => ({ ...prev, [player.name]: combined.percentage }));
        // Round 3 Rang 16: same rows, no extra query — just a finer-grained breakdown of the
        // same throws already fetched above for the overall rate.
        const doubleBreakdown = combineCheckoutDoubleBreakdowns(
          data.map((leg) => checkoutDoubleBreakdown(leg.throws as unknown as DartThrow[], leg.starting_score))
        );
        if (doubleBreakdown.length > 0) setCheckoutDoubleRates((prev) => ({ ...prev, [player.name]: doubleBreakdown }));
      });
  }, [game, phase, dbPlayers]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(WALKON_PREF_KEY, JSON.stringify(walkonEnabled));
  }, [walkonEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(INPUT_MODE_PREF_KEY, dartInputMode);
  }, [dartInputMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SOUND_PREF_KEY, JSON.stringify(soundEnabled));
  }, [soundEnabled]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (botTimerRef.current) clearTimeout(botTimerRef.current);
    };
  }, []);

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

  /** A Geist-bot's display name names its target instead of a generic skill tier — shown
   *  wherever a bot's name would otherwise appear (setup preview, in-game scoreboard, saved
   *  game record). */
  const botDisplayName = (i: number): string => {
    if (playerGhostTarget[i] !== "off") return `👻 ${t("game.ghostRecord")}`;
    return t(BOT_PROFILES[playerBotLevel[i] ?? "medium"].nameKey);
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
    // Standard Elo expected-score formula — independent of head-to-head history, so it's still
    // meaningful (arguably most useful) for two players who've never played each other before.
    const aWinProb = 100 / (1 + Math.pow(10, ((b.elo_rating ?? 1000) - (a.elo_rating ?? 1000)) / 400));
    const { data, error } = await supabase.from("games")
      .select("winner_id, player1_id, player1_average, player2_average, played_at")
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
      // Uses the names as typed for THIS match (not the resolved club-roster names) so the
      // storyline text always matches the names already shown on the two player columns above it.
      storyline: buildRivalryStoryline(
        data.map((g) => ({ aWon: g.winner_id === a.id, playedAt: g.played_at })),
        players[0].name, players[1].name, t,
      ),
      aWinProb,
    });
  };

  // Fired once per match start, same pattern as loadWalkonH2H above. X01 only (Cricket's "best
  // leg" isn't a dart-count race the same way) and individual only (team games don't have a
  // single person's "own" leg to race). Looks for a Geist-bot among the players (see the bot
  // picker's 4th option) — its target sequence gets assigned to the HUMAN players' slots (they're
  // the ones with a turn-based indicator to show it against), not the bot's own slot.
  const loadGhostSequences = async (players: PlayerSlot[], startScore: number, teams?: TeamSlot[]) => {
    const ghostBotIdx = players.findIndex((p, i) => p.isBot && playerGhostTarget[i] !== "off");
    if (ghostBotIdx === -1 || teams || mode === "cricket") {
      setGhostSequences(players.map(() => null));
      return;
    }
    const assignToHumans = (seq: number[] | null) => setGhostSequences(players.map((p) => (p.isBot ? null : seq)));
    // "own-pb" (the only target Ghost mode offers): the HUMAN opponent races their own best-ever WON leg at this exact start score
    // (fewest darts) — the Geist-bot embodies it back at them. Small data volumes here (a club's
    // total leg count, not the whole games table) — picking the shortest client-side rather than
    // needing a jsonb-array-length order clause PostgREST can't express directly.
    const human = players.find((p) => !p.isBot);
    const match = human ? matchClubPlayer(dbPlayers, human.name) : undefined;
    if (!match) {
      assignToHumans(null);
      return;
    }
    const resolved = await (async (): Promise<number[] | null> => {
      const { data } = await supabase.from("game_legs")
        .select("throws")
        .eq("player_id", match.id)
        .eq("starting_score", startScore)
        .eq("won", true);
      if (!data || data.length === 0) return null;
      let best: DartThrow[] | null = null;
      for (const row of data) {
        const throws = row.throws as unknown as DartThrow[];
        if (!best || throws.length < best.length) best = throws;
      }
      return best ? ghostRemainingSequence(best, startScore) : null;
    })();
    assignToHumans(resolved);
  };

  // Whether the follow-up stat-comparison screen (see the "stats" phase render below) has
  // anything worth showing — a real (non-team) 1v1 where at least one side matches a roster
  // player. Bot games, guest-vs-guest test rounds, and team matches skip straight from the
  // walk-on card to play, same as before this screen existed.
  // useCallback (not a plain function) so its identity is stable across renders unless dbPlayers
  // itself changes — `game` is passed in as a parameter rather than read via closure specifically
  // so this doesn't also need to depend on it, letting the walk-on effect below list this as a
  // dependency without re-running on every unrelated render.
  const walkonHasStats = useCallback((g: GameState | null): boolean => {
    if (!g || g.teams || g.players.length !== 2) return false;
    return !!matchClubPlayer(dbPlayers, g.players[0].name) || !!matchClubPlayer(dbPlayers, g.players[1].name);
  }, [dbPlayers]);

  /** `starterOverride`: used by startRematch() only — it needs the JUST-swapped starter to take
   *  effect in this exact call, and setStarterIndex() alone wouldn't be visible yet to the
   *  starterIndex read below (same stale-closure issue as any setState immediately followed by
   *  reading the old value in the same synchronous call). Kept as a separate function (not
   *  startGame's own signature) so every existing `onClick={startGame}` reference stays a plain
   *  zero-arg handler instead of needing a wrapper at each call site. */
  const startGameWithStarter = (starterOverride?: number) => {
    const startScore = getStartScore();
    const n = numPlayers;
    const players: PlayerSlot[] = Array.from({ length: n }, (_, i) => ({
      name: playerIsBot[i]
        ? botDisplayName(i)
        : (playerNames[i]?.trim() || `Spieler ${i + 1}`),
      doubleOut: playerDoubleOut[i] ?? true,
      doubleIn: playerDoubleIn[i] ?? false,
      isBot: mode === "cricket" ? playerIsBot[i] : playerIsBot[i],
      botLevel: playerBotLevel[i] ?? "medium",
      handicap: !teamMode && mode !== "cricket" ? (playerHandicap[i] || 0) : undefined,
    }));
    const teams = teamMode ? [{ name: teamNames[0].trim() || "Team 1" }, { name: teamNames[1].trim() || "Team 2" }] : undefined;
    const scoreSlots = teams?.length ?? n;
    const effectiveStarterIndex = starterOverride ?? starterIndex;
    // Team mode only ever offers a choice of 2 (which team starts, via each team's first
    // member); clamp defensively either way in case the player count shrank after picking a
    // starter further back in the list.
    const starter = teamMode ? (effectiveStarterIndex % 2 === 0 ? 0 : 1) : Math.min(effectiveStarterIndex, n - 1);
    const newGame: GameState = {
      mode, startScore, bestOfLegs, players,
      legsWon: Array(scoreSlots).fill(0),
      currentLeg: createLegState(1, startScore, starter, players, teams), completedLegs: [],
      currentPlayerIndex: starter, isFinished: false,
      maxRoundsX01: mode !== "cricket" && maxRoundsX01 > 0 ? maxRoundsX01 : undefined,
      teams,
      // Sets-Modus: bestOfLegs above is reinterpreted as "legs per set" once this is set (see
      // GameState.setsMode's own doc comment) — no separate field needed for that half of it.
      ...(mode !== "cricket" && setsEnabled ? { setsMode: { bestOfSets }, setsWon: Array(scoreSlots).fill(0) } : {}),
    };
    if (mode === "cricket") {
      const cricketNumbers = customCricket ? generateRandomCricketNumbers() : [...CRICKET_NUMBERS];
      newGame.cricketNumbers = cricketNumbers;
      newGame.cricket = Array.from({ length: scoreSlots }, () => createCricketState(cricketNumbers));
    }
    setGame(newGame);
    void loadWalkonH2H(players, teams);
    void loadGhostSequences(players, startScore, teams);
    setDartsThisRound(0);
    // Must read the CHOSEN starter's own slot, not always slot 0 — with per-player handicaps
    // (or asymmetric team scores) these differ, and turnStartRemaining is exactly what a bust
    // on the opening throw reverts to (see handleX01Throw's bust branch). Reading slot 0
    // unconditionally silently corrupted a non-player-0 starter's score by the handicap gap
    // the moment they busted their very first visit.
    setTurnStartRemaining(newGame.currentLeg.remaining[starter] ?? startScore);
    setUndoStack([]);
    botPlanRef.current = null;
    botLegConfigRef.current = {};
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

  const startGame = () => startGameWithStarter();

  // Board-mode auto-start countdown — a board-linked match starts itself instead of waiting for
  // a tap; "Bearbeiten" (setAutoStartCanceled) opts out for the rare case something needs
  // adjusting first. Depends on tournamentLinkName (state), not tournamentLinkRef.current.board
  // directly — the ref is set in the same prefill effect that sets tournamentLinkName, but
  // mutating a ref doesn't itself trigger a re-render/re-check, so this needs a real state
  // dependency guaranteed to change in that same tick to reliably see the board value. Also
  // requires boardStartGate === "clear" — see that effect's comment for why an Extern round,
  // a live-play-disabled tournament, or a suspected collision must never auto-start unattended.
  useEffect(() => {
    if (phase !== "setup" || !tournamentLinkRef.current?.board || autoStartCanceled || boardStartGate !== "clear") return;
    setAutoStartSecondsLeft(Math.ceil(AUTOSTART_DELAY_MS / 1000));
    const tick = window.setInterval(() => setAutoStartSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    const finish = window.setTimeout(() => startGame(), AUTOSTART_DELAY_MS);
    return () => { window.clearInterval(tick); window.clearTimeout(finish); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, autoStartCanceled, tournamentLinkName, boardStartGate]);

  /** Goes from setup/warm-up into the actual match — via the walk-on intro if enabled. Wrapped in
   *  useCallback so its identity only changes when walkonEnabled does — a plain function here
   *  would get a new reference every render, and the effect below needs a STABLE one to depend
   *  on without re-running (and re-triggering setPhase) on every unrelated re-render. */
  const enterMatch = useCallback(() => setPhase(walkonEnabled ? "walkon" : "playing"), [walkonEnabled]);

  // ─── warm-up (pre-match, doesn't touch game/stats) ──────────────────
  useEffect(() => {
    if (phase !== "warmup" || warmupRemaining <= 0) return;
    const t = setTimeout(() => setWarmupRemaining((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, warmupRemaining]);

  useEffect(() => {
    if (phase === "warmup" && warmupRemaining <= 0) enterMatch();
  }, [phase, warmupRemaining, enterMatch]);

  // ─── walk-on intro (pre-match, doesn't touch game/stats) ────────────
  useEffect(() => {
    if (phase !== "walkon") return;
    if (soundEnabled) playWalkonSound();
    const t = setTimeout(() => setPhase(walkonHasStats(game) ? "stats" : "playing"), WALKON_DURATION_MS);
    return () => clearTimeout(t);
  }, [phase, game, soundEnabled, walkonHasStats]);

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
      toast({ title: t("game.bustTitle"), description: `${game.players[idx].name} — ${t("game.remainingStaysAt")} ${turnStartRemaining}.`, variant: "destructive" });
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
        return applyLegWin(prev, prev, updatedLeg, teamIdx);
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
              return applyLegWin(next, prev, updatedLeg, winners[0]);
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
    let capOutcome: RoundCapOutcome = null;
    if (newRemaining !== 0 && newDartsThisRound >= 3) {
      const throwsAfter = game.players.map((_, i) => (i === idx ? game.currentLeg.throws[i].length + 1 : game.currentLeg.throws[i].length));
      const roundsPerPlayer = throwsAfter.map((len) => Math.ceil(len / 3));
      const remainingAfter = game.currentLeg.remaining.map((r, si) => (si === teamIdx ? newRemaining : r));
      capOutcome = resolveRoundCap(game.maxRoundsX01, roundsPerPlayer, remainingAfter, game.teams);
    }

    if (newRemaining === 0) {
      setDartsThisRound(0);
      const nextStarter = (game.currentLeg.startingPlayerIndex + 1) % n;
      setTurnStartRemaining(effectiveStartScore(game.startScore, game.players, nextStarter, game.teams));
      flashScore(teamIdx);
      const matchWon = wouldWinMatch(game, teamIdx);
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
      const matchWon = wouldWinMatch(game, legWinner);
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
    const matchWon = wouldWinMatch(game, winnerIndex);
    const winnerName = game.teams ? game.teams[winnerIndex].name : game.players[winnerIndex].name;
    setGame((prev) => {
      if (!prev) return prev;
      return applyLegWin(prev, prev, prev.currentLeg, winnerIndex);
    });
    setDartsThisRound(0);
    flashScore(winnerIndex);
    triggerConfetti();
    toast({ title: t("game.bulledOutTitle"), description: `${winnerName} ${t("game.winsLegViaBullOff")}` });
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

      applyCricketDart(myState, others, cricketNumbers as readonly number[], targetNumber, baseValue, mul);

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
        club_id: clubId,
        game_id: pendingGameIdRef.current,
        player_id: playerMatch?.id || null,
        player_name: params.playerName,
        kind: params.kind,
        points: params.points,
        darts: params.darts as unknown as Json,
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
        applyCricketDart(myState, others, cricketNumbers as readonly number[], targetNumber, d.baseValue, d.multiplier);
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
          Object.assign(curGame, applyLegWin(curGame, curGame, curGame.currentLeg, teamIdx));
          if (!curGame.isFinished) {
            curStart = curGame.currentLeg.remaining[teamIndexFor(curGame.teams, curGame.currentPlayerIndex)];
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
    let capOutcome: RoundCapOutcome = null;
    if (curGame.mode !== "cricket" && !busted && !checkedOut && !curGame.isFinished) {
      const roundsPerPlayer = curGame.players.map((_, i) => Math.ceil(curGame.currentLeg.throws[i].length / 3));
      capOutcome = resolveRoundCap(curGame.maxRoundsX01, roundsPerPlayer, curGame.currentLeg.remaining, curGame.teams);
    }

    if (capOutcome?.kind === "winner") {
      // Same "leg won" treatment the checkout branch above gets, just keyed to the cap's unique
      // lowest-remaining winner instead of whoever threw the round that happened to reach the cap.
      const legWinner = capOutcome.legWinner;
      Object.assign(curGame, applyLegWin(curGame, curGame, curGame.currentLeg, legWinner));
      if (!curGame.isFinished) {
        curStart = curGame.currentLeg.remaining[teamIndexFor(curGame.teams, curGame.currentPlayerIndex)];
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
      toast({ title: t("game.bustTitle"), description: `${game.players[startIdx].name} — ${t("game.remainingStaysAt")} ${curStart}.`, variant: "destructive" });
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

    // Live-KI-Kommentator (2026-09-10) — deliberately sparse: only fires for a genuinely
    // noteworthy moment (bust, leg/match win, 180, ton-plus), never for a routine sub-100 round,
    // both to keep the feature feeling like real color commentary rather than narrating every
    // dart, and to bound the AI-call volume over a full evening of camera-scored legs. Fully
    // non-blocking and fire-and-forget: fetchLiveCommentary() never throws (see its own doc
    // comment), and the resulting line — once it arrives, a network round-trip later — is spoken
    // with interrupt:false so it queues in behind whatever the normal caller is still saying
    // rather than talking over it.
    if (aiCommentaryEnabled && clubHasFeature(club?.plan_tier, "ai-commentary") && session?.access_token) {
      const aiEvent: CommentaryEvent | null =
        busted ? "bust" :
        checkedOut && curGame.isFinished ? "match_win" :
        checkedOut ? "leg_win" :
        roundTotal === 180 ? "180" :
        roundTotal > 100 ? "ton_plus" :
        null;
      if (aiEvent) {
        const activePlayerName = game.players[startIdx].name;
        const nextPlayerName = curGame.players[curGame.currentPlayerIndex].name;
        const remaining = curGame.mode === "cricket" ? undefined : curGame.currentLeg.remaining[teamIndexFor(curGame.teams, startIdx)];
        fetchLiveCommentary({
          event: aiEvent, playerName: activePlayerName, opponentName: nextPlayerName,
          roundTotal, remaining, mode: curGame.mode, accessToken: session.access_token,
        }).then((line) => {
          if (line) window.setTimeout(() => speakText(line, { interrupt: false }), 900);
        });
      }
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
    // Thresholds per Martin's 2026-09-09 request: only genuinely good throws — a high checkout
    // (>50, so routine small finishes like a checkout of 2-40 no longer trigger a clip) or a high
    // scoring round (>120, up from the old >=100 "any ton" bar). checkedOut also covers the
    // round-cap "winner" reuse (see its own comment above) — gating on roundTotal here too means
    // a cap-decided leg only counts as highlight-worthy if the round that ended it was itself a
    // genuinely big one, same bar as everything else.
    const isHighlightCheckout = checkedOut && roundTotal > 50;
    const isHighlightScore = roundTotal > 120;
    if (!busted && (isHighlightCheckout || isHighlightScore)) {
      const clip = liveCameraRef.current?.getRecentClip();
      if (clip) {
        setClipPopup({
          url: clip.url,
          mime: clip.mime,
          total: roundTotal,
          is180: roundTotal === 180,
          isCheckout: checkedOut,
          isTonPlus: roundTotal > 120 && roundTotal !== 180,
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
      if (prev.mode === "cricket") {
        // Cricket's marks/points can't be patched incrementally the way X01's remaining is
        // below — whether a hit still scored points depended on whether every opponent had
        // already closed that number AT THE TIME, which a simple point reversal can't undo
        // correctly. Replay the whole leg from scratch instead — see replayCricketState's own
        // comment for why this is a correctness requirement, not just thoroughness.
        const cricket = replayCricketState(updatedLeg.throws, prev.currentLeg.startingPlayerIndex, prev.teams, prev.cricketNumbers ?? CRICKET_NUMBERS);
        return { ...prev, currentLeg: updatedLeg, cricket };
      }
      updatedLeg.remaining[teamIndexFor(prev.teams, playerIdx)] += removed.points;
      return { ...prev, currentLeg: updatedLeg };
    });
    if (isCurrentRoundThrow) setDartsThisRound((d) => Math.max(0, d - 1));
    setEditingChipIdx(null);
    // Edit MODE (editingThrowIdx) deliberately stays open — correcting one mis-tap rarely means
    // that was the only one this round, and re-opening "Bearbeiten" per dart was exactly the
    // friction being fixed here.
  };

  /** Changes a past dart's recorded value IN PLACE (same array index) instead of removing it —
   *  deleting a mid-round dart shifts every later dart's index, which silently reshuffles which
   *  darts group into which visit (180-count, highest-visit, and the round-by-round display all
   *  read visits by array position). Re-validates the same legality rules real scoring already
   *  enforces (can't bust the visit, can't finish on a non-double under double-out) rather than
   *  trusting the edit blindly — a correction tool that can silently corrupt the leg worse than
   *  the mistake it was fixing would be worse than not having it. */
  const editThrowValue = (playerIdx: number, throwIndex: number, newBase: number, newMultiplier: 1 | 2 | 3) => {
    if (!game) return;
    const oldDart = game.currentLeg.throws[playerIdx]?.[throwIndex];
    if (!oldDart) return;
    const newPoints = pointsFor(newBase, newMultiplier);

    if (game.mode === "cricket") {
      setGame((prev) => {
        if (!prev) return prev;
        const newThrows = [...prev.currentLeg.throws[playerIdx]];
        newThrows[throwIndex] = { baseValue: newBase, multiplier: newMultiplier, points: newPoints };
        const updatedLeg: LegState = { ...prev.currentLeg, throws: [...prev.currentLeg.throws] };
        updatedLeg.throws[playerIdx] = newThrows;
        // Cricket marks/points can't be patched incrementally — see deleteThrow's own comment
        // on replayCricketState just above.
        const cricket = replayCricketState(updatedLeg.throws, prev.currentLeg.startingPlayerIndex, prev.teams, prev.cricketNumbers ?? CRICKET_NUMBERS);
        return { ...prev, currentLeg: updatedLeg, cricket };
      });
      setEditingChipIdx(null);
      return;
    }

    const n = game.players.length;
    const teamIdx = teamIndexFor(game.teams, playerIdx);
    const currentRemaining = remainingRef.current[teamIdx] ?? game.currentLeg.remaining[teamIdx];
    const doubleOut = game.players[playerIdx].doubleOut ?? true;
    // Reframed as "what if this exact slot had originally been thrown as newBase/newMultiplier" —
    // reconstructs the remaining as it stood right before this dart (undo just this one dart's
    // points), then reuses isBustThrow itself rather than re-deriving its bust conditions here.
    const remainingBeforeThisDart = currentRemaining + oldDart.points;
    const newRemaining = remainingBeforeThisDart - newPoints;
    const isDouble = qualifyingDouble(newMultiplier);
    if (isBustThrow(remainingBeforeThisDart, newPoints, doubleOut, isDouble)) {
      toast({
        title: t("game.invalidValue"),
        description: newRemaining < 0 ? t("game.wouldMakeNegative") : t("game.checkoutMustEndDouble"),
        variant: "destructive",
      });
      return;
    }

    remainingRef.current[teamIdx] = newRemaining;
    setGame((prev) => {
      if (!prev) return prev;
      const newThrows = [...prev.currentLeg.throws[playerIdx]];
      newThrows[throwIndex] = { baseValue: newBase, multiplier: newMultiplier, points: newPoints };
      const updatedLeg: LegState = { ...prev.currentLeg, throws: [...prev.currentLeg.throws], remaining: [...prev.currentLeg.remaining] };
      updatedLeg.throws[playerIdx] = newThrows;
      updatedLeg.remaining[teamIdx] = newRemaining;
      // The edited dart now finishes the leg (e.g. correcting a checkout that got mis-entered
      // as something else) — same completion path a real checkout dart triggers.
      if (newRemaining === 0) return applyLegWin(prev, prev, updatedLeg, teamIdx);
      return { ...prev, currentLeg: updatedLeg };
    });

    if (newRemaining === 0) {
      setDartsThisRound(0);
      const nextStarter = (game.currentLeg.startingPlayerIndex + 1) % n;
      setTurnStartRemaining(effectiveStartScore(game.startScore, game.players, nextStarter, game.teams));
      triggerConfetti();
      if (soundEnabled) setTimeout(() => playCheckoutSound(), 100);
    }
    setEditingChipIdx(null);
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
    // Belt-and-suspenders: the curated QUICK_ROUNDS presets are all real achievable totals, but
    // this same handler also serves the free-typed "Eintippen" mode — reject anything a real
    // 3-dart visit could never add up to, rather than have splitQuickRound silently fabricate a
    // fake per-dart breakdown for it (that breakdown gets persisted into game_legs.throws and
    // would corrupt downstream per-dart stats like 180-count and aim bias).
    if (!isAchievableVisitTotal(total)) return;
    submitDetectedRound(splitQuickRound(total), undefined, true);
  };

  const shareResult = async () => {
    if (!game || !postGameStats || sharingResult) return;
    setSharingResult(true);
    try {
      // KI-Spielbericht (2026-09-09): folded into the share card when one's already been
      // generated — a fresh read rather than threading AiMatchReport's own state up through
      // props, since it's cheap (single-row, single-column, primary-key select) and this is the
      // one other place that needs it. Silently omitted (not an error) when nobody generated one
      // for this match, or the game isn't durably saved yet (queuedOffline) — the share card
      // works exactly as it always did without it either way.
      let aiReport: string | undefined;
      if (gameSaved && !queuedOffline) {
        const { data } = await supabase.from("games").select("ai_report").eq("id", pendingGameIdRef.current).maybeSingle();
        aiReport = data?.ai_report ?? undefined;
      }
      await shareOrDownloadResultImage(
        {
          clubName,
          mode: game.mode === "custom" ? `Custom ${game.startScore}` : game.mode,
          winnerName: game.winnerName ?? "?",
          bestOfLegs: game.bestOfLegs,
          players: postGameStats.map((p) => ({ name: p.name, average: p.overall.average, highscore: p.overall.highscore, s180: p.overall.s180, legs: p.legs })),
          aiReport,
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
    botLegConfigRef.current = {};
    clearActiveGameSnapshot();
    setPhase("setup"); setGame(null); setGameSaved(false); setShowDetailedStats(false);
    setSelectedLegTab("all");
    setDartsThisRound(0); setUndoStack([]);
  };

  /** One-tap "Revanche" from the finished-game overlay — re-runs startGame() with whatever setup
   *  state is already sitting in memory (players/mode/legs/etc.), instead of sending the user back
   *  through the setup screen to reconfigure the exact same thing. Only the finished-game cleanup
   *  resetGame() also does (bot timer/refs, the stale snapshot, gameSaved so the NEW game's own
   *  finish doesn't get silently skipped by that stale flag) — deliberately skips resetGame's
   *  `setPhase("setup"); setGame(null)`, since startGame() below already sets its own phase.
   *
   *  Whoever didn't start last time starts this one — common darts etiquette, and without it the
   *  same player would open every single rematch in a row. Advances to the next player/team in
   *  turn order (a strict swap for the usual 2-player case, a fair rotation for 3+); passed
   *  straight into startGameWithStarter() rather than only through setStarterIndex(), since that
   *  alone wouldn't be visible yet to startGameWithStarter()'s own read of starterIndex in this
   *  same call. */
  const startRematch = () => {
    if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }
    clearActiveGameSnapshot();
    setGameSaved(false);
    setShowDetailedStats(false);
    setSelectedLegTab("all");
    const nextStarter = teamMode ? starterIndex + 1 : (starterIndex + 1) % numPlayers;
    setStarterIndex(nextStarter);
    startGameWithStarter(nextStarter);
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
    // Geist-bot: instead of a fixed skill tier, pace this bot toward its ghost target's average
    // — not an attempt to reconstruct its exact recorded dart-by-dart sequence (which risks
    // landing on a remaining score with no valid double-out finish at all, mid-game), just an
    // overall skill level that feels roughly right for the target. See configForAverage's own
    // doc comment for why this tradeoff was made over exact reconstruction.
    let botConfig: BotLevel | LevelConfig = level;
    if (mode !== "cricket" && playerGhostTarget[idx] !== "off") {
      const target = playerGhostTarget[idx];
      let avgPerRound: number | null = null;
      if (typeof target === "number") {
        avgPerRound = (game.startScore / target) * 3;
      } else {
        const humanIdx = game.players.findIndex((p) => !p.isBot);
        const seq = humanIdx !== -1 ? ghostSequences[humanIdx] : null;
        if (seq && seq.length > 0) avgPerRound = (game.startScore / seq.length) * 3;
      }
      if (avgPerRound !== null) botConfig = configForAverage(avgPerRound);
    } else if (mode !== "cricket") {
      // Not a Geist-bot: still don't play the exact same average every leg — a real opponent
      // has better and worse legs too. Rolled once per (player, leg) and cached, not re-rolled
      // per dart, so a leg stays internally consistent while the NEXT leg gets its own fresh
      // "how's this leg going for them" roll. See rollConfigForLevel's own doc comment.
      const legKey = `${idx}-${game.currentLeg.legNumber}`;
      botConfig = botLegConfigRef.current[legKey] ??= rollConfigForLevel(level);
    }

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
          const visit = simulateBotVisit(game.currentLeg.remaining[teamIdx], player.doubleOut ?? true, botConfig, mustDoubleIn);
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
    // ghostSequences is a real dependency, not just for the linter: if the current turn's bot
    // is a Geist-bot and this effect first fires before loadGhostSequences' async fetch has
    // resolved (the opponent's own-record lookup, specifically), it must re-run once that
    // resolves so botConfig gets computed from the real sequence length instead of null.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.currentPlayerIndex, game?.currentLeg.legNumber, dartsThisRound, game?.isFinished, phase, pendingTiebreak, playerGhostTarget, ghostSequences]);

  // useCallback with an honest dependency list (rather than a plain function) so the triggering
  // effect below can depend on this directly instead of needing its own eslint-disable — the
  // internal savingRef/gameSaved guards already make a redundant call harmless either way, this
  // is about the dependency array actually being correct, not a behavior change.
  const saveGame = useCallback(async () => {
    if (!game || !game.isFinished || savingRef.current || gameSaved) return;
    savingRef.current = true;
    const link = tournamentLinkRef.current ?? undefined;
    // Positional, not name-based — GameState.players[0] doesn't reliably line up with the
    // bracket's own player1 for an online match (whoever tapped "Online" first becomes slot 0, see
    // the online-tournament resolution effect above), so game.winnerName/legsWon[0]/[1] alone
    // aren't trustworthy there the way they always were for local/board-mode play. Falls back to
    // exactly the old name/legsWon-based values whenever link.player1Name/player2Name aren't
    // present (any local game, or an old crash-recovery snapshot from before this field existed) —
    // a no-op for local play.
    const winnerSlot0 = (game.winnerIndex ?? (game.legsWon[0] >= game.legsWon[1] ? 0 : 1)) === 0;
    const linkPlayer1IsGameSlot0 = link?.player1IsGameSlot0 ?? true;
    const tournamentWinnerName = (link?.player1Name && link?.player2Name)
      ? (winnerSlot0 === linkPlayer1IsGameSlot0 ? link.player1Name : link.player2Name)
      : game.winnerName!;
    // Sets-Modus: game.legsWon only ever holds the FINAL set's tally once this match used sets
    // (see legLogic.ts's applyLegWin) — showing that alone on the bracket would read as, say,
    // "3:1" for what was actually a 2:1-in-sets win decided by a 3:1 final set, which is exactly
    // the wrong number to put on a tournament bracket. game.setsWon (never reset mid-match, see
    // GameState.setsMode's own doc comment) is the real match score whenever it's present.
    const legsOrSetsWon = game.setsMode && game.setsWon ? game.setsWon : game.legsWon;
    const tournamentScore1 = linkPlayer1IsGameSlot0 ? legsOrSetsWon[0] : legsOrSetsWon[1];
    const tournamentScore2 = linkPlayer1IsGameSlot0 ? legsOrSetsWon[1] : legsOrSetsWon[0];
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("offline");
      await saveGameRecord(game, session?.user?.id, clubId, pendingGameIdRef.current, link, !!onlineMatchId);
      if (game.players.length > 2) {
        toast({ title: t("game.gameSavedTitle"), description: t("game.gameSavedAllPlayersDesc") });
      }
      if (link) {
        try {
          await recordMatchResult(link.tournamentId, link.matchId, {
            winnerName: tournamentWinnerName,
            score1: tournamentScore1,
            score2: tournamentScore2,
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
            winnerName: tournamentWinnerName,
            score1: tournamentScore1,
            score2: tournamentScore2,
          });
          toast({
            title: t("game.tournamentPending"),
            description: t("game.tournamentPendingDesc"),
          });
        }
      }
      const leagueLink = leagueLinkRef.current;
      if (leagueLink) {
        // GameState.players[0]/[1] only line up 1:1 with the fixture's own player1/player2 when
        // player1IsGameSlot0 — true unconditionally for local play, but an online-played fixture
        // can have it flipped (see the resolution effect that sets this ref for that case).
        const fixtureP1Legs = leagueLink.player1IsGameSlot0 ? game.legsWon[0] : game.legsWon[1];
        const fixtureP2Legs = leagueLink.player1IsGameSlot0 ? game.legsWon[1] : game.legsWon[0];
        const leagueResult = {
          winnerId: fixtureP1Legs > fixtureP2Legs ? leagueLink.player1Id : leagueLink.player2Id,
          player1LegsWon: fixtureP1Legs,
          player2LegsWon: fixtureP2Legs,
          gameId: pendingGameIdRef.current,
          guardPending: true,
        };
        try {
          await applyLeagueFixtureResult(leagueLink.fixtureId, leagueResult);
        } catch (syncErr) {
          // Round 3 backend audit KORREKTUR: this used to be silently best-effort (console.error
          // only, no retry, no user-facing indication) — the exact same failure mode the
          // tournament bracket write-back just above already queues and retries. Same fix here:
          // queue it, and tell the user, instead of letting it vanish until someone notices the
          // league table looks wrong.
          console.error("league fixture write-back failed, queuing for retry", syncErr);
          await enqueueLeagueFixtureResult({ id: `${pendingGameIdRef.current}-league`, fixtureId: leagueLink.fixtureId, ...leagueResult });
          toast({ title: t("game.leaguePending"), description: t("game.leaguePendingDesc") });
        }
      }
    } catch (err) {
      // No connection (or a mid-request drop) — the result is far too valuable to lose, so
      // it's queued in IndexedDB and replayed automatically once the app is back online
      // (see offlineQueue.ts / App.tsx). The client-generated pendingGameIdRef keeps the
      // eventual insert idempotent even if this fires more than once. The tournament bracket
      // write-back gets its own queue entry for the same reason — it needs a live read of the
      // bracket, so it can't just be retried as part of the game-save replay.
      await enqueueGameSave({ id: pendingGameIdRef.current, game, userId: session?.user?.id, clubId, tournamentLink: link, playedOnline: !!onlineMatchId });
      if (link) {
        await enqueueMatchResult({
          id: `${pendingGameIdRef.current}-match`,
          tournamentId: link.tournamentId,
          matchId: link.matchId,
          winnerName: tournamentWinnerName,
          score1: tournamentScore1,
          score2: tournamentScore2,
        });
      }
      // Same reasoning as the tournament bracket entry above, now also covering the case where
      // the whole save failed BEFORE the leagueLink block inside the try was even reached (see
      // Round 3 backend audit KORREKTUR) — previously a league fixture write-back was only ever
      // attempted at all when saveGameRecord itself succeeded, so a genuinely-offline device lost
      // it outright rather than queuing it like every other write-back here does.
      const leagueLinkForQueue = leagueLinkRef.current;
      if (leagueLinkForQueue) {
        const fixtureP1Legs = leagueLinkForQueue.player1IsGameSlot0 ? game.legsWon[0] : game.legsWon[1];
        const fixtureP2Legs = leagueLinkForQueue.player1IsGameSlot0 ? game.legsWon[1] : game.legsWon[0];
        await enqueueLeagueFixtureResult({
          id: `${pendingGameIdRef.current}-league`,
          fixtureId: leagueLinkForQueue.fixtureId,
          winnerId: fixtureP1Legs > fixtureP2Legs ? leagueLinkForQueue.player1Id : leagueLinkForQueue.player2Id,
          player1LegsWon: fixtureP1Legs,
          player2LegsWon: fixtureP2Legs,
          gameId: pendingGameIdRef.current,
          guardPending: true,
        });
      }
      setQueuedOffline(true);
      // Genuinely offline (the explicit check above, before any network call was even attempted)
      // vs. some OTHER failure while apparently online (a dropped mid-request connection, a
      // server error, an expired session) used to get the identical "no connection, syncs once
      // back online" message — actively misleading for the second case: the device might already
      // BE online, so promising a sync "once back online" sets an expectation that can never be
      // met, and if the real cause is e.g. an expired session, the retry queue keeps failing
      // identically forever with no indication why. Doesn't try to detect the exact cause (a
      // fragile heuristic to get right blind) — just stops asserting "offline" when we know
      // that's not true.
      const genuinelyOffline = err instanceof Error && err.message === "offline";
      toast({
        title: genuinelyOffline ? t("game.savedOfflineTitle") : t("game.saveFailedQueuedTitle"),
        description: genuinelyOffline
          ? (link ? t("game.savedOfflineWithLinkDesc") : t("game.savedOfflineNoLinkDesc"))
          : t("game.saveFailedQueuedDesc"),
      });
    }
    // Only now — either branch above has already gotten this game durably somewhere (Supabase
    // directly, or the offline queue) — is it actually safe to drop the crash-recovery copy.
    clearActiveGameSnapshot();
    setGameSaved(true);
    savingRef.current = false;
    // tournamentLinkRef/leagueLinkRef identities never change (see the snapshot-mirroring
    // effect's comment above for why they're listed at all despite that).
  }, [game, gameSaved, session, clubId, toast, t, tournamentLinkRef, leagueLinkRef, onlineMatchId]);

  useEffect(() => {
    if (game?.isFinished && !gameSaved && session?.user?.id) saveGame();
  }, [game?.isFinished, gameSaved, session?.user?.id, saveGame]);

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
    // cricketWinAnnouncedRef makes any extra re-run (e.g. `game` also changing on every dart
    // thrown before the match ends) a harmless no-op — it only actually announces once.
  }, [game, speechEnabled]);

  const postGameStats = useMemo(() => computePostGameStats(game), [game]);

  /** Which leg's numbers the post-game screen currently shows — "all" (match-wide) or a 0-based
   *  leg index. Reset on every new game via resetGame so a stale leg selection doesn't survive
   *  into the next match's (possibly single-leg) result. */
  const [selectedLegTab, setSelectedLegTab] = useState<number | "all">("all");
  const statFor = (p: NonNullable<typeof postGameStats>[number]): StatBundle =>
    selectedLegTab === "all" ? p.overall : (p.perLeg[selectedLegTab] ?? p.overall);

  // Which SEGMENT_NUMBERS rows are worth a line in the field-breakdown grid — hoisted out of
  // the per-player JSX map below so it's computed once for the whole comparison, not once per
  // player card.
  const visibleSegmentRows = useMemo(() => {
    if (!postGameStats) return [];
    return SEGMENT_NUMBERS.filter((n) =>
      postGameStats.some((p) => {
        const segments = statFor(p).segments;
        return segmentCount(segments, n, 1) + segmentCount(segments, n, 2) + segmentCount(segments, n, 3) > 0;
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postGameStats, selectedLegTab]);

  // ─── ONLINE MATCH: waiting for the row to load/become active ──────────
  // Reached only in the brief window before the sync effect above transitions phase straight to
  // "playing" (or if the match somehow isn't active — declined/canceled/already finished — in
  // which case this stays showing rather than falling through to the normal local setup form,
  // which would silently let two people configure and play an unrelated LOCAL game instead).
  if (onlineMatchId && phase === "setup") {
    const notActive = onlineMatch.row && onlineMatch.row.status !== "active";
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center p-6">
        {notActive ? (
          <>
            <p className="text-sm text-muted-foreground">{t("game.onlineMatchNotActive")}</p>
            <Button onClick={() => navigate("/")} className="mt-2">{t("common.backToHome")}</Button>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t("game.onlineMatchLoading")}</p>
          </>
        )}
      </div>
    );
  }

  // ─── SETUP PHASE ───────────────────────────────
  // "PIN pro Spieler": verifies the entered PIN against the selected club member's stored
  // hash+salt (@/lib/playerPin) entirely client-side — no network round-trip, so it works
  // offline once the roster (usePlayers/dbPlayers, including pin_hash/pin_salt) is loaded. On
  // success the name is written into the slot exactly like the no-PIN path always did; on
  // failure the field just clears for another try — no lockout, this is a casual "is this really
  // you" check among club mates, not a security boundary against someone who's actually trying.
  const submitPinPrompt = async () => {
    if (!pinPrompt || pinPromptValue.length !== 4) return;
    setPinPromptChecking(true);
    const ok = await verifyPin(pinPromptValue, pinPrompt.player.pin_salt ?? "", pinPrompt.player.pin_hash ?? "");
    setPinPromptChecking(false);
    if (ok) {
      const { slotIndex, player } = pinPrompt;
      setPlayerNames(prev => prev.map((v, idx) => idx === slotIndex ? player.name : v));
      setPinPrompt(null);
      setPinPromptValue("");
      setPinPromptError(false);
    } else {
      setPinPromptError(true);
      setPinPromptValue("");
    }
  };

  // ─── SETUP PHASE ────────────────────────────────────
  // Extracted to GameSetup.tsx (Design-Sprint Phase 3, "Spiel-Screen in eigenständige
  // Teil-Screens aufteilen") — pure JSX relocation, all state stays here and is passed as props.
  if (phase === "setup") {
    return (
      <GameSetup
        tournamentLinkRef={tournamentLinkRef}
        tournamentLinkName={tournamentLinkName}
        leagueLinkRef={leagueLinkRef}
        autoStartCanceled={autoStartCanceled}
        setAutoStartCanceled={setAutoStartCanceled}
        boardStartGate={boardStartGate}
        autoStartSecondsLeft={autoStartSecondsLeft}
        startGame={startGame}
        mode={mode}
        setMode={setMode}
        customStartScore={customStartScore}
        setCustomStartScore={setCustomStartScore}
        teamMode={teamMode}
        setTeamMode={setTeamMode}
        numPlayers={numPlayers}
        setNumPlayers={setNumPlayers}
        teamNames={teamNames}
        setTeamNames={setTeamNames}
        bestOfLegs={bestOfLegs}
        setBestOfLegs={setBestOfLegs}
        setsEnabled={setsEnabled}
        setSetsEnabled={setSetsEnabled}
        bestOfSets={bestOfSets}
        setBestOfSets={setBestOfSets}
        checkoutSuggestionEnabled={checkoutSuggestionEnabled}
        setCheckoutSuggestionEnabled={setCheckoutSuggestionEnabled}
        showAdvancedSetup={showAdvancedSetup}
        revealAdvancedSetup={revealAdvancedSetup}
        customCricket={customCricket}
        setCustomCricket={setCustomCricket}
        maxRoundsX01={maxRoundsX01}
        setMaxRoundsX01={setMaxRoundsX01}
        playerNames={playerNames}
        setPlayerNames={setPlayerNames}
        dbPlayers={dbPlayers}
        playerIsBot={playerIsBot}
        setPlayerIsBot={setPlayerIsBot}
        playerBotLevel={playerBotLevel}
        setPlayerBotLevel={setPlayerBotLevel}
        playerGhostTarget={playerGhostTarget}
        setPlayerGhostTarget={setPlayerGhostTarget}
        playerDoubleIn={playerDoubleIn}
        setPlayerDoubleIn={setPlayerDoubleIn}
        playerDoubleOut={playerDoubleOut}
        setPlayerDoubleOut={setPlayerDoubleOut}
        playerHandicap={playerHandicap}
        setPlayerHandicap={setPlayerHandicap}
        botDisplayName={botDisplayName}
        getStartScore={getStartScore}
        pinPrompt={pinPrompt}
        setPinPrompt={setPinPrompt}
        pinPromptValue={pinPromptValue}
        setPinPromptValue={setPinPromptValue}
        pinPromptError={pinPromptError}
        setPinPromptError={setPinPromptError}
        pinPromptChecking={pinPromptChecking}
        submitPinPrompt={submitPinPrompt}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
        speechEnabled={speechEnabled}
        callerVoice={callerVoice}
        changeCallerVoice={changeCallerVoice}
        starterIndex={starterIndex}
        setStarterIndex={setStarterIndex}
        warmupEnabled={warmupEnabled}
        setWarmupEnabled={setWarmupEnabled}
        warmupSeconds={warmupSeconds}
        setWarmupSeconds={setWarmupSeconds}
        walkonEnabled={walkonEnabled}
        setWalkonEnabled={setWalkonEnabled}
        setupMode={setupMode}
        setSetupMode={setSetupMode}
      />
    );
  }

  // ─── WARM-UP PHASE ─────────────────────────────────
  // Extracted to GameWarmup.tsx (Design-Sprint Phase 3, "Spiel-Screen in eigenständige
  // Teil-Screens aufteilen") — pure JSX relocation, all state stays here and is passed as props.
  if (phase === "warmup") {
    return (
      <GameWarmup
        warmupRemaining={warmupRemaining}
        warmupDarts={warmupDarts}
        warmupTotal={warmupTotal}
        setWarmupRemaining={setWarmupRemaining}
        submitWarmupDart={submitWarmupDart}
        enterMatch={enterMatch}
      />
    );
  }

  // ─── WALK-ON INTRO / STATS ──────────────────────────
  // Extracted to GameWalkon.tsx (Design-Sprint Phase 3, "Spiel-Screen in eigenständige
  // Teil-Screens aufteilen") — pure JSX relocation, all state stays here and is passed as props.
  if (phase === "walkon" && game) {
    return <GameWalkonIntro game={game} walkonHasStats={walkonHasStats} onAdvance={setPhase} />;
  }

  if (phase === "stats" && game) {
    return <GameWalkonStats game={game} dbPlayers={dbPlayers} walkonH2H={walkonH2H} onAdvance={() => setPhase("playing")} />;
  }

  if (!game) return null;

  const activeIdx = game.currentPlayerIndex;
  const activeTeamIdx = teamIndexFor(game.teams, activeIdx);
  const currentPlayerName = game.players[activeIdx].name;
  const currentRemaining = game.currentLeg.remaining[activeTeamIdx];
  const currentThrows = game.currentLeg.throws[activeIdx];
  const scoreLabels = game.teams ? game.teams.map((tm) => tm.name) : game.players.map((p) => p.name);
  // 4 stays a plain 2x2 on mobile (already balanced); 5+ gets 3 columns instead of 2 even
  // below md — otherwise a 6/7/8-player game stacks 3-4 rows tall on a phone, pushing the dart
  // pad below the thumb-reachable zone before a single dart's been thrown.
  const numCols = scoreLabels.length <= 2 ? "grid-cols-2" : scoreLabels.length === 3 ? "grid-cols-3" : scoreLabels.length === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-3 md:grid-cols-4";
  const awaitingDoubleIn = !isCricket && (currentPlayer?.doubleIn ?? false) && !(game.currentLeg.startedScoring?.[activeTeamIdx] ?? true);

  const doubleInBanner = awaitingDoubleIn ? (
    <div className="mb-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-center text-xs text-accent font-display uppercase tracking-wide">
      {t("game.doubleInRequired")} {game.teams ? `${game.teams[activeTeamIdx].name} (${currentPlayerName})` : currentPlayerName} {t("game.doubleInRequiredSuffix")}
    </div>
  ) : null;

  const cricketBoard = isCricket && game.cricket ? (
    <div className="gradient-card rounded-xl border border-border shadow-elevation-sm p-3 mb-3 overflow-x-auto">
      <table className="w-full text-center text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left font-normal text-muted-foreground pb-1 pr-2">{t("game.target")}</th>
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
            <td className="text-left text-muted-foreground pt-1 pr-2">{t("game.points")}</td>
            {game.cricket!.map((c, i) => (
              <td key={i} className={`pt-1 font-display ${i === activeTeamIdx ? "text-primary font-bold" : ""}`}>{c.points}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  ) : null;

  // Scoreboard — extracted so it can render in two different DOM positions depending on mode
  // (see the PLAYING PHASE return below) while staying `shrink-0` pinned above whichever region
  // actually scrolls in that mode (the info column's throw-history tail in manual mode, or the
  // camera window's own scrollable content area in camera mode). The sticky/will-change classes
  // below are harmless when it isn't inside a scrolling ancestor (manual mode's own wrapper is
  // `shrink-0`, not scrolling) — kept anyway since this same block is shared with camera mode,
  // where it still matters: it used to sit OUTSIDE that scrollable area entirely there (a
  // `shrink-0` flex sibling above it, not sticky within it) — visually indistinguishable from
  // "sticky", but reported as the numbers scrolling separately from the rest of the page, since
  // the camera window itself is a fixed, non-page-scrolling overlay.
  // Momentum indicator: how many legs in a row the CURRENTLY-LEADING-on-recent-form score slot has
  // just won, walking backward from the most recently completed leg. Deliberately reads
  // game.completedLegs (the whole match's history) rather than anything set-scoped — a streak that
  // spans a Sets-Modus set boundary ("won the last leg of set 1, then the first two of set 2") is
  // still a real 3-in-a-row and should still read as one, not reset just because setsWon ticked up.
  // null below 2 in a row on purpose: a lone leg win isn't "momentum", it's just the score.
  const legStreak = (() => {
    const legs = game.completedLegs;
    if (legs.length === 0) return null;
    const lastWinner = legs[legs.length - 1]?.winnerIndex;
    if (lastWinner === undefined) return null;
    let count = 0;
    for (let i = legs.length - 1; i >= 0 && legs[i].winnerIndex === lastWinner; i--) count++;
    return count >= 2 ? { slot: lastWinner, count } : null;
  })();

  const scoreboardBlock = (
    // Round 4: still `sticky top-0` here because the camera-enabled branch further below renders
    // this inside its own single, plain scrolling container — one level of sticky, no CSS grid
    // underneath it — and that combination was never what real-device reports flagged. The bug
    // (toolbar missing until the first throw, header losing its sticky tracking right after) kept
    // reproducing even after removing backdrop-filter, which turned out not to be the actual
    // cause — the real culprit was the manual-entry branch nesting THIS already-sticky element
    // inside a second, grid-track-nested sticky wrapper of its own. That branch no longer does
    // that at all now — see its own comment below for the actual fix. bg-background (no /95, no
    // blur) is kept here regardless, since a fully opaque header is simply more legible.
    <div className="sticky top-0 z-30 -mx-4 px-4 pt-3 pb-2 landscape:pt-1.5 landscape:pb-1 bg-background border-b border-border/40 will-change-transform">
      {/* Online-match connection health — a dropped/backgrounded realtime channel used to fail
          silently (see useOnlineMatch's connectionStatus doc comment): a player could keep tapping
          on a board that was quietly no longer live. Shown right at the top of the always-visible
          sticky scoreboard, not buried in a toast that could be missed. */}
      {onlineMatchId && onlineMatch.connectionStatus !== "connected" && (
        <div className="flex items-center justify-center gap-1.5 mb-2 py-1 rounded-md bg-accent/10 text-accent text-[11px] font-medium">
          {onlineMatch.connectionStatus === "reconnecting" ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> {t("game.onlineReconnecting")}</>
          ) : (
            <><WifiOff className="w-3 h-3" /> {t("game.onlineDisconnected")}</>
          )}
        </div>
      )}
      <div className={`grid ${numCols} gap-3 landscape:gap-1.5`}>
        {(game.teams
          ? game.teams.map((t, ti) => {
              const memberIdxs = game.players.map((_, pi) => pi).filter((pi) => teamIndexFor(game.teams, pi) === ti);
              const throws = memberIdxs.flatMap((pi) => game.currentLeg.throws[pi]);
              return {
                key: ti, label: t.name, subLabel: memberIdxs.map((pi) => game.players[pi].name).join(" & "),
                isBot: false, remaining: game.currentLeg.remaining[ti], cricketPoints: game.cricket?.[ti]?.points ?? 0,
                avg: calculateAverage(throws), p180: count180s(throws), legsWon: game.legsWon[ti],
                setsWon: game.setsWon?.[ti],
                isActive: activeTeamIdx === ti,
              };
            })
          : game.players.map((p, i) => ({
              key: i, label: p.name, subLabel: undefined as string | undefined,
              isBot: p.isBot, remaining: game.currentLeg.remaining[i], cricketPoints: game.cricket?.[i]?.points ?? 0,
              avg: calculateAverage(game.currentLeg.throws[i]), p180: count180s(game.currentLeg.throws[i]),
              legsWon: game.legsWon[i], setsWon: game.setsWon?.[i], isActive: activeIdx === i,
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
          // Used to hold at turnStartRemaining (the pre-round value) for manual entry until all
          // 3 darts landed, only jumping at round-end. That masked any change to `remaining` made
          // mid-round — including a scorekeeper correcting an earlier throw via ThrowHistoryEditor,
          // whose effect then silently didn't show until the in-progress round happened to finish.
          // Always showing the true live value trades away the end-of-round "reveal" but means the
          // number on screen is never stale.
          const displayRemaining = previewRemaining;
          const isFlashing = scoreFlash?.slot === card.key;
          // "An der Oché" Broadcast-Arena (Design-Sprint Runde 3 Punkt 2, Richtung A): both
          // player cards now sit on the same fixed-dark broadcast surface used everywhere else
          // this look was rolled out (see index.css's .broadcast-panel comment) — the active
          // player's name gets the solid cyan broadcast-tag, the waiting player's the same
          // angled tag shape recolored neutral, exactly mirroring PublicTournament.tsx's
          // Board-Übersicht card. Score-state colors (accent on preview/flash, muted while
          // waiting) stay hardcoded hsl() rather than the usual text-accent/text-muted-foreground
          // classes for the same reason as everywhere else on this panel: those Tailwind tokens
          // are tuned per light/dark theme, but this panel's background never follows the theme.
          const activeHsl = "hsl(185 85% 48%)";
          const scoreColor = isFlashing || showPreview ? "hsl(45 100% 58%)" : isActive ? "hsl(210 15% 94%)" : "hsl(210 15% 55%)";
          // Everything below this point still leans on ordinary Tailwind semantic classes
          // (text-muted-foreground, text-primary, bg-accent/20, …) for the footer badges, dart
          // pills and active-player extras — instead of hand-converting every one of those to a
          // hardcoded color, the card overrides the underlying CSS variables themselves to their
          // *dark*-theme values, the same way the top-level `.dark` block in index.css defines
          // them. Every semantic class nested inside then resolves correctly no matter the
          // viewer's own light/dark setting, without needing to touch each usage individually.
          const darkVarOverrides = {
            "--background": "222 30% 5%", "--foreground": "210 15% 92%",
            "--card": "222 25% 9%", "--card-foreground": "210 15% 92%",
            "--primary": "185 85% 48%", "--primary-foreground": "222 30% 5%",
            "--secondary": "155 65% 42%", "--secondary-foreground": "0 0% 100%",
            "--muted": "222 20% 14%", "--muted-foreground": "222 12% 50%",
            "--accent": "45 100% 58%", "--accent-foreground": "222 30% 5%",
            "--destructive": "0 72% 51%", "--destructive-foreground": "0 0% 100%",
            "--border": "222 18% 14%",
          } as any;
          return (
            <div key={card.key}
              className={`broadcast-panel p-4 landscape:p-3 border-2 transition-all text-center ${isActive ? "glow-cyan" : "opacity-80"}`}
              style={{ ...darkVarOverrides, borderColor: isActive ? activeHsl : "hsl(222 18% 20%)" }}>
              <div className="flex items-center justify-center gap-1.5">
                {isActive && <span className="inline-block h-2 w-2 rounded-full animate-pulse-glow" style={{ background: activeHsl }} />}
                {card.isBot && <Bot className="w-3 h-3 shrink-0" style={{ color: "hsl(155 65% 55%)" }} />}
                <span
                  className="broadcast-tag inline-flex max-w-full px-2.5 py-0.5 rounded-[2px]"
                  style={!isActive ? { background: "hsl(222 20% 18%)" } : undefined}
                >
                  <span
                    className="text-sm font-display font-semibold truncate max-w-[8.5rem]"
                    style={{ color: isActive ? undefined : "hsl(210 15% 78%)" }}
                  >
                    {card.label}
                  </span>
                </span>
              </div>
              {card.subLabel && (
                <p className="text-[10px] truncate mt-0.5" style={{ color: isActive ? "hsl(185 60% 65%)" : "hsl(210 15% 50%)" }}>
                  {card.subLabel}{isActive ? ` · ${t("game.turnLabel")}: ${currentPlayerName}` : ""}
                </p>
              )}
              {isActive && card.isBot && botThinking ? (
                <p className="text-sm font-display mt-1 animate-pulse" style={{ color: "hsl(155 65% 55%)" }}>Bot {t("game.isThrowing")}…</p>
              ) : (
                // Deliberately the SAME size in both orientations (no landscape: shrink) — this is
                // the number a player reads from throwing distance, not from right up close, and
                // landscape has its own dedicated column now (see the playing-phase layout below)
                // with room to spare, so there's no longer a reason to make it smaller there.
                <p
                  className={`text-5xl font-display mt-1 transition-colors tabular-nums ${isFlashing ? "animate-pulse-glow" : ""}`}
                  style={{ color: scoreColor, textShadow: isActive ? `0 0 22px ${scoreColor}80` : undefined }}
                >
                  <AnimatedScore value={isCricket ? card.cricketPoints : displayRemaining} />
                </p>
              )}
              {/* min-h reserves this line even while showPreview is false, same reasoning as the
                  pendingCameraDarts/activeRound block below — without it, this line popping in and
                  out exactly as a checkout comes into range (pendingTotal only goes positive once a
                  camera dart lands) shifted the sticky scoreboard's own height on every such dart,
                  the most visible moment for it to happen. */}
              <p className="text-[10px] text-muted-foreground -mt-1 min-h-[14px]">
                {showPreview && `(${card.remaining} − ${pendingTotal} live)`}
              </p>
              {/* min-h reserves this row's space even before the first dart of the round lands —
                  it used to only exist once pendingCameraDarts/activeRound had content, so the
                  card grew taller the instant the first dart registered, shoving everything below
                  (the number pad, mid-tap) down and forcing a scroll. Reserving the space up
                  front keeps the layout stable across the whole round instead of just after it starts. */}
              {/* Landscape: these badges used to be full portrait size (px-2 py-1 text-sm) inside
                  an already-narrower card (landscape:p-3 above), which routinely wrapped to 2 rows
                  and pushed the whole sticky header taller than it needed to be, eating into the
                  pad/history space below. Smaller padding/font + a lower reserved min-height in
                  landscape keeps the same information at a size actually proportioned to that
                  layout instead of just reusing portrait's. */}
              {isActive && cameraEnabled && (
                <div className="mt-1 flex min-h-8 landscape:min-h-6 items-center justify-center gap-1.5 landscape:gap-1 flex-wrap">
                  {pendingCameraDarts.map((t, idx) => (
                    <span key={idx} className="rounded bg-accent/20 px-2 py-1 landscape:px-1.5 landscape:py-0.5 text-sm landscape:text-xs font-display text-accent ring-1 ring-accent/40">
                      {dartLabel(t)}
                    </span>
                  ))}
                </div>
              )}
              {isActive && (
                <div className="mt-1 flex min-h-8 landscape:min-h-6 items-center justify-center gap-1.5 landscape:gap-1 flex-wrap">
                  {activeRound.map((t, idx) => (
                    <span key={idx} className="rounded bg-primary/15 px-2 py-1 landscape:px-1.5 landscape:py-0.5 text-sm landscape:text-xs font-display text-primary">
                      {dartLabel(t)}
                    </span>
                  ))}
                  {activeRound.length > 0 && <span className="ml-1 text-sm landscape:text-xs font-display text-accent">+{currentRoundTotal}</span>}
                </div>
              )}
              <div className="flex justify-center flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                <span>Ø {card.avg.toFixed(1)}</span>
                {/* Sets-Modus: the match-level score (sets) leads, the current set's leg race
                    (which resets to 0 every new set — see applyLegWin) follows right after it —
                    "2 Sätze · 1 Leg" reads as "leading 2 sets, and 1 leg up in the current one",
                    not as two competing/contradicting numbers. */}
                {game.setsMode && <span className="text-secondary font-bold">{card.setsWon ?? 0} {t("game.setsSuffix")}</span>}
                {game.bestOfLegs > 1 && <span className="text-primary font-bold">{card.legsWon} {t("game.legsSuffix")}</span>}
                {legStreak?.slot === card.key && (
                  <span className="text-orange-400 font-bold animate-pulse-glow">🔥 {legStreak.count} {t("game.legsInARow")}</span>
                )}
                {card.p180 > 0 && <span className="text-accent font-bold">🎯{card.p180}</span>}
              </div>
              {/* Active-player extras folded into the card itself (single-out note, dart counter,
                  ghost pace) instead of a second section repeating the same turn info below the
                  whole grid — that duplicate section was the main reason the playing screen still
                  needed to scroll on short phones, and the active card already carries enough
                  visual weight (border glow, pulse dot, highlighted name) that restating "X is
                  throwing" next to it added no information, only height. */}
              {isActive && (
                <>
                  {!isCricket && !(currentPlayer?.doubleOut ?? true) && (
                    <p className="text-[10px] text-muted-foreground mt-1">({t("game.singleOut")})</p>
                  )}
                  <div className="flex justify-center gap-1 mt-1.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className={`w-2 h-2 rounded-full transition-all ${i < dartsThisRound ? "bg-primary" : "bg-muted"}`} />
                    ))}
                  </div>
                  {game && !currentPlayer?.isBot && ghostSequences[currentIdx] && (() => {
                    const teamIdx = teamIndexFor(game.teams, currentIdx);
                    const cmp = compareToGhost(game.currentLeg.throws[currentIdx]?.length ?? 0, game.currentLeg.remaining[teamIdx], ghostSequences[currentIdx]!);
                    if (!cmp) return null;
                    const targetLabel = t("game.yourRecordPace");
                    return (
                      <p className={`text-[10px] mt-1 font-medium ${cmp.aheadBy > 0 ? "text-secondary" : cmp.aheadBy < 0 ? "text-muted-foreground" : "text-accent"}`}>
                        {/* "Behind" used to be the only flat, silent case here (no "!" the way "ahead"
                            gets one) — a bare live deficit with no balancing thought, dart after dart,
                            all leg long. Gets its own closing note now instead of staying silent. */}
                        👻 {cmp.aheadBy > 0 ? `${cmp.aheadBy} ${t("game.pointsAhead")} ${targetLabel}!` : cmp.aheadBy < 0 ? `${Math.abs(cmp.aheadBy)} ${t("game.pointsBehind")} ${targetLabel} — ${t("game.stillTimeToCatchUp")}` : `${t("game.exactlyOnPace")} ${targetLabel}`}
                      </p>
                    );
                  })()}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Leg info bar — with Sets-Modus active this also names which set is currently being
          played, since `game.currentLeg.legNumber` is a running count across the WHOLE match
          (never reset at a set boundary, see applyLegWin) and would otherwise read like "Leg 7"
          deep into a sets match with no indication that's actually early in set 3. */}
      {game.bestOfLegs > 1 && (
        <div className="text-center text-xs landscape:text-[10px] text-muted-foreground mt-2 landscape:mt-1">
          {game.setsMode && <>{t("game.set")} {(game.setsWon ?? []).reduce((s, v) => s + v, 0) + 1} · </>}
          {t("game.leg")} {game.currentLeg.legNumber} · {game.players[game.currentLeg.startingPlayerIndex].name} {t("game.startsFirst")}
        </div>
      )}
    </div>
  );

  // ─── PLAYING PHASE ─────────────────────────────────
  // Always a fixed, full-viewport shell now, not the page's own document flow — camera mode
  // already proved this pattern out (see the memory of its scroll fixes). Manual entry used to
  // fall back to "container ... max-w-lg mx-auto", a plain block that (a) capped width at 512px
  // no matter the device or orientation, which is exactly why it stayed phone-narrow on an iPad
  // in landscape, and (b) had no scroll boundary of its own at all — only the scoreboard was
  // sticky, so once the page scrolled far enough to reach the number pad, the checkout suggestion
  // and thrown-darts badges above it were simply gone. See the manual-entry branch below for the
  // landscape/portrait split this now enables.
  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col animate-slide-up overflow-hidden">
      {confettiKey !== null && <ConfettiBurst triggerKey={confettiKey} />}
      {/* Winner overlay */}
      {game.isFinished && (
        <div className="fixed inset-0 bg-background/85 backdrop-blur-sm z-50 flex items-center justify-center overflow-y-auto overscroll-y-contain py-8">
          <GamePostGame
            game={game}
            postGameStats={postGameStats}
            statFor={statFor}
            selectedLegTab={selectedLegTab}
            setSelectedLegTab={setSelectedLegTab}
            showDetailedStats={showDetailedStats}
            setShowDetailedStats={setShowDetailedStats}
            visibleSegmentRows={visibleSegmentRows}
            gameSaved={gameSaved}
            queuedOffline={queuedOffline}
            pendingGameIdRef={pendingGameIdRef}
            sharingResult={sharingResult}
            shareResult={shareResult}
            tournamentLinkName={tournamentLinkName}
            tournamentLinkRef={tournamentLinkRef}
            leagueLinkRef={leagueLinkRef}
            startRematch={startRematch}
            resetGame={resetGame}
            navigate={navigate}
          />
        </div>
      )}

      {pendingTiebreak && (
        <div className="mx-4 mb-3 rounded-lg border-2 border-accent bg-accent/10 p-3 text-center animate-pulse-glow">
          <p className="font-display text-sm uppercase tracking-wide text-accent">{t("game.tiebreakReached")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {pendingTiebreak.tiedIndexes.map((i) => scoreLabels[i]).join(" vs. ")} {t("game.tiebreakTied")}
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
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-4 pb-3">
            {scoreboardBlock}
            {doubleInBanner}
            {pendingCheckoutChoice && (
              <div className="mb-3 rounded-lg border-2 border-accent bg-accent/10 p-3 text-center animate-pulse-glow">
                <p className="font-display text-sm uppercase tracking-wide text-accent">{t("game.possibleFinishDetected")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("game.whichDartWasLast")}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                  {pendingCheckoutChoice.darts.map((t, idx) => (
                    <Badge key={idx} variant="outline" className={`px-1.5 py-0.5 text-[10px] font-display ${
                      pendingCheckoutChoice.doubleIndexes.includes(idx)
                        ? "bg-accent/20 text-accent border-accent/40"
                        : "bg-muted text-muted-foreground border-border"
                    }`}>
                      {dartLabel(t)}
                    </Badge>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {pendingCheckoutChoice.doubleIndexes.map((idx) => (
                    <Button key={idx} size="sm" onClick={() => resolveCheckoutChoice(idx)} className="gap-1">
                      {t("game.doneWith")} {dartLabel(pendingCheckoutChoice.darts[idx])}
                    </Button>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => resolveCheckoutChoice("bust")}>
                    {t("game.noFinishBust")}
                  </Button>
                </div>
              </div>
            )}
            {/* Screen-Audit Richtung 1 (reservierte Status-Zone): always mounted now, gate passed
                in as `active` — see CheckoutSuggestion's own doc comment for why the old
                `{condition && <CheckoutSuggestion/>}` wrapping caused the "scoreboard jumps"
                complaint on every turn change, not just on remaining-score changes. */}
            <CheckoutSuggestion
              active={checkoutSuggestionEnabled && !isCricket && !currentPlayer?.isBot && !awaitingDoubleIn && (currentPlayer?.doubleOut ?? true)}
              remaining={currentRemaining} playerName={currentPlayerName}
              personalCheckoutRate={checkoutRates[currentPlayerName] ?? null}
              personalDoubleBreakdown={checkoutDoubleRates[currentPlayerName] ?? null}
            />

            {!currentPlayer?.isBot && (
              // A camera/ONNX failure on an unfamiliar Android/browser combo only takes down this
              // card, not the whole match — manual entry (further below) stays fully available
              // either way. Suspense's fallback only ever shows for the brief one-time chunk
              // fetch, not per-render, since the dynamic import resolves and caches after that.
              <ErrorBoundary label="Kamera">
                <Suspense fallback={<div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>}>
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
                </Suspense>
              </ErrorBoundary>
            )}

            {cricketBoard}

            {/* Live-KI-Kommentator (2026-09-10) — only offered once the camera is actually on
                (there's nothing for it to react to otherwise) and the club's plan includes it;
                a personal on/off toggle on top of that plan gate, same reasoning as
                aiCommentary.ts's own doc comment on why both checks exist. */}
            {cameraEnabled && clubHasFeature(club?.plan_tier, "ai-commentary") && (
              <button
                onClick={toggleAiCommentary}
                className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-xs mb-3 transition-colors ${aiCommentaryEnabled ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
              >
                <span className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> {t("game.aiCommentaryToggle")}</span>
                <span className="text-[10px] uppercase">{aiCommentaryEnabled ? t("common.on") : t("common.off")}</span>
              </button>
            )}

            {/* Manual entry stays fully available — just tucked away by default since the camera scores for you. */}
            <button
              onClick={() => setShowManualInput((v) => !v)}
              className="w-full flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted mb-3"
            >
              <span className="flex items-center gap-1.5"><Keyboard className="w-3.5 h-3.5" /> {t("game.manualEntry")}</span>
              {showManualInput ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showManualInput && (
              <DartScoreInput isDisabled={game.isFinished || !!currentPlayer?.isBot || !!pendingTiebreak || !!pendingCheckoutChoice || (!!onlineMatchId && !onlineMatch.isMyTurn)}
                onThrow={throwDart}
                onQuickRound={!isCricket && !currentPlayer?.isBot ? handleQuickRound : undefined}
                inputMode={dartInputMode} onInputModeChange={setDartInputMode}
                dartsThisRound={dartsThisRound} />
            )}

            {/* Correcting a mis-tap used to require opening "Manuelle Eingabe" first, then
                finding this section inside it — two collapsed layers deep, easy to miss
                especially while scoring with the camera (this doesn't need the number pad open
                at all, just the ability to review/edit/delete a wrong throw). Now always visible
                whenever there's something to correct, independent of that toggle. */}
            <ThrowHistoryEditor
              throws={currentThrows}
              playerName={currentPlayerName}
              editModeOn={editingThrowIdx !== null}
              onToggleEditMode={() => setEditingThrowIdx(editingThrowIdx !== null ? null : 0)}
              openChipIdx={editingChipIdx}
              onOpenChipChange={setEditingChipIdx}
              onEditThrow={(throwIdx, base, mul) => editThrowValue(activeIdx, throwIdx, base, mul)}
              onDeleteThrow={(throwIdx) => deleteThrow(activeIdx, throwIdx)}
            />

            <Button variant="ghost" onClick={() => setConfirmCancelGame(true)} className="w-full mt-3 text-muted-foreground">
              <RotateCcw className="w-4 h-4 mr-2" /> {t("game.cancelGame")}
            </Button>
          </div>

          {/* Compact bottom bar — always reachable, no matter how tall the camera/manual-input content gets. */}
          <div className="shrink-0 border-t border-border bg-background/95 backdrop-blur px-4 py-2.5 flex gap-2">
            <Button variant="outline" onClick={undoLastDart} disabled={undoStack.length === 0 || !!pendingCheckoutChoice || !!pendingTiebreak || !!onlineMatchId} title={onlineMatchId ? t("game.undoDisabledOnline") : undefined} className="flex-1 gap-1">
              <Undo2 className="w-4 h-4" /> {t("game.undo")}
            </Button>
            <Button
              variant={showManualInput ? "default" : "outline"}
              onClick={() => setShowManualInput((v) => !v)}
              className="gap-1"
              title={t("game.toggleManualEntry")}
            >
              <Keyboard className="w-4 h-4" />
            </Button>
            <Button
              variant="default"
              onClick={() => { cameraWantedRef.current = false; setCameraEnabled(false); }}
              className="gap-1"
              title={t("game.closeCamera")}
            >
              <Camera className="w-4 h-4" /> {t("game.camOff")}
            </Button>
            <Button variant="outline" onClick={() => setSoundEnabled(!soundEnabled)} className="gap-1" title={soundEnabled ? t("game.soundOff") : t("game.soundOn")} aria-label={soundEnabled ? t("game.soundOff") : t("game.soundOn")}>
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
          </div>
        </>
      ) : (
        // Manual entry, Round 4 rewrite: the header used to be `sticky top-0` nested one level
        // INSIDE a second, also-`sticky top-0` wrapper div that was itself a CSS Grid track —
        // reported back from real Android devices, twice now (first with backdrop-filter on the
        // inner sticky element, then without it — see scoreboardBlock's own comment above), as:
        // the whole Undo/Cam/Sound/Cancel bar missing completely before the first throw, only
        // snapping into place once a dart is entered, and the header losing its sticky tracking
        // (becoming scrollable again) right after. Neither backdrop-filter removal nor
        // will-change-transform fixed it, because neither was the actual cause — nested sticky
        // positioning inside a CSS Grid track is itself a known compositing trouble spot on some
        // Android WebView/Chrome builds. This drops position:sticky from this branch entirely:
        // header and toolbar are now plain `shrink-0` flex siblings that never scroll and never
        // need to "stick" to anything — exactly the same pattern the camera-enabled branch's own
        // bottom bar already uses (a few hundred lines up), which was never reported to have this
        // bug. Only the pad + throw history scroll now, in the middle.
        <>
          <div className="shrink-0 bg-background px-4">
            {scoreboardBlock}
            {doubleInBanner}
            {/* Screen-Audit Richtung 1 — same always-mounted fix as the camera branch above. */}
            <CheckoutSuggestion
              active={checkoutSuggestionEnabled && !isCricket && !currentPlayer?.isBot && !awaitingDoubleIn && (currentPlayer?.doubleOut ?? true)}
              remaining={currentRemaining} playerName={currentPlayerName}
              personalCheckoutRate={checkoutRates[currentPlayerName] ?? null}
              personalDoubleBreakdown={checkoutDoubleRates[currentPlayerName] ?? null}
            />
            {cricketBoard}
          </div>

          {/* Pad + history — the only part of this layout that scrolls now. Portrait stacks
              pad-then-history (the pad is the primary, most-frequently-tapped control, so it comes
              first); landscape splits them into two columns side by side (1fr history : 2fr pad,
              same ratio as before), so reaching history no longer means scrolling past the pad in
              that orientation either. */}
          <div className="flex-1 min-h-0 grid grid-cols-1 landscape:grid-cols-[1fr_2fr] overflow-y-auto overscroll-y-contain landscape:overflow-hidden px-4">
            <div className="pt-3 pb-3 landscape:col-start-2 landscape:min-h-0 landscape:overflow-y-auto landscape:overscroll-y-contain">
              <DartScoreInput isDisabled={game.isFinished || !!currentPlayer?.isBot || !!pendingTiebreak || !!pendingCheckoutChoice}
                onThrow={throwDart}
                onQuickRound={!isCricket && !currentPlayer?.isBot ? handleQuickRound : undefined}
                inputMode={dartInputMode} onInputModeChange={setDartInputMode}
                dartsThisRound={dartsThisRound} />
            </div>

            {/* Correcting a mis-tap now scrolls independently of the pad instead of always sitting
                below its full height — a short scroll away in portrait, or right alongside the pad
                with no scrolling at all in landscape. */}
            <div className="pb-3 landscape:col-start-1 landscape:row-start-1 landscape:min-h-0 landscape:overflow-y-auto landscape:overscroll-y-contain">
              <ThrowHistoryEditor
                throws={currentThrows}
                playerName={currentPlayerName}
                editModeOn={editingThrowIdx !== null}
                onToggleEditMode={() => setEditingThrowIdx(editingThrowIdx !== null ? null : 0)}
                openChipIdx={editingChipIdx}
                onOpenChipChange={setEditingChipIdx}
                onEditThrow={(throwIdx, base, mul) => editThrowValue(activeIdx, throwIdx, base, mul)}
                onDeleteThrow={(throwIdx) => deleteThrow(activeIdx, throwIdx)}
              />
            </div>
          </div>

          {/* Footer — always reachable no matter how tall the pad or history above gets, the same
              non-sticky "shrink-0 border-t" bottom bar the camera-enabled branch already uses
              successfully. Undo/Cam/Sound/Cancel used to live inside the scrolling pad cell, one
              more thing that could end up below the fold on a short phone; pinning them here
              instead guarantees they're on screen from the very first frame, before any dart has
              been thrown — the actual bug report this rewrite targets. */}
          <div className="shrink-0 border-t border-border bg-background px-4 py-2.5 flex gap-2">
            <Button variant="outline" onClick={undoLastDart} disabled={undoStack.length === 0 || !!pendingCheckoutChoice || !!pendingTiebreak || !!onlineMatchId} title={onlineMatchId ? t("game.undoDisabledOnline") : undefined} className="flex-1 gap-1">
              <Undo2 className="w-4 h-4" /> {t("game.undo")}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!clubHasFeature(club?.plan_tier, "camera")) {
                  toast({ title: t("plan.cameraGatedTitle"), description: t("plan.cameraGatedDesc") });
                  return;
                }
                cameraWantedRef.current = true; setCameraEnabled(true);
              }}
              disabled={!!currentPlayer?.isBot}
              className="gap-1"
              title={t("game.liveCameraScoring")}
            >
              <Camera className="w-4 h-4" /> {t("game.cam")}
            </Button>
            <Button variant="outline" onClick={() => setSoundEnabled(!soundEnabled)} className="gap-1" title={soundEnabled ? t("game.soundOff") : t("game.soundOn")} aria-label={soundEnabled ? t("game.soundOff") : t("game.soundOn")}>
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
            <Button variant="outline" onClick={() => setConfirmCancelGame(true)} className="gap-1 text-muted-foreground hover:text-destructive" title={t("game.cancelGame")} aria-label={t("game.cancelGame")}>
              <RotateCcw className="w-4 h-4" />
            </Button>
          </div>
        </>
      )}

      <AlertDialog open={confirmCancelGame} onOpenChange={setConfirmCancelGame}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("game.cancelGameConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("game.cancelGameConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={resetGame}>{t("game.cancelGame")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default GamePage;
