import { useState, useCallback, useEffect } from "react";
import { Dumbbell, Target, RotateCw, Crosshair, Zap, Trophy, Play, ArrowLeft, RotateCcw, CheckCircle, Camera, Lock, Shuffle, Settings2, PartyPopper, Divide, ListOrdered, Route, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import DartScoreInput from "@/components/game/DartScoreInput";
import CheckoutSuggestion from "@/components/game/CheckoutSuggestion";
import CoachingPlan from "@/components/training/CoachingPlan";
import LiveCamera, { type DetectedDart } from "@/components/game/LiveCamera";
import { CHECKOUT_ROUTES } from "@/utils/checkoutTable";
import { isAchievableVisitTotal } from "@/utils/dartStats";
import { useLanguage } from "@/contexts/LanguageContext";
import { Sparkline } from "@/components/stats/StatPrimitives";
import { useToast } from "@/hooks/use-toast";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { clubHasFeature } from "@/lib/planFeatures";

/** Drills with an X01-style countdown checkout target — the only ones a visit-TOTAL (quick-round
 *  presets, typed total, or voice) can apply to, since the other drills need to know WHICH segment
 *  was hit, not just a sum. */
const CHECKOUT_DRILL_IDS = ["121-challenge", "pressure-training", "random-finish"];

/** Training drill definition */
interface TrainingDrill {
  id: string;
  name: string;
  descriptionKey: string;
  icon: typeof Target;
  difficulty: "beginner" | "intermediate" | "pro";
  durationMinutes: number;
  category: "doubles" | "finishing" | "accuracy" | "pressure";
}

/** Available training drills */
const TRAINING_DRILLS: TrainingDrill[] = [
  {
    id: "doubles-only",
    name: "Doubles Only",
    descriptionKey: "training.doublesOnlyDesc",
    icon: Target,
    difficulty: "beginner",
    durationMinutes: 15,
    category: "doubles",
  },
  {
    id: "around-the-clock",
    name: "Around the Clock",
    descriptionKey: "training.aroundTheClockDesc",
    icon: RotateCw,
    difficulty: "beginner",
    durationMinutes: 10,
    category: "accuracy",
  },
  {
    id: "121-challenge",
    name: "121 Challenge",
    descriptionKey: "training.121ChallengeDesc",
    icon: Crosshair,
    difficulty: "intermediate",
    durationMinutes: 10,
    category: "finishing",
  },
  {
    id: "pressure-training",
    name: "Pressure Training",
    descriptionKey: "training.pressureTrainingDesc",
    icon: Zap,
    difficulty: "pro",
    durationMinutes: 20,
    category: "pressure",
  },
  {
    id: "random-finish",
    name: "Random Finish Drill",
    descriptionKey: "training.randomFinishDesc",
    icon: Trophy,
    difficulty: "intermediate",
    durationMinutes: 15,
    category: "finishing",
  },
  {
    id: "target-grind",
    name: "Target Grind",
    descriptionKey: "training.targetGrindDesc",
    icon: Target,
    difficulty: "intermediate",
    durationMinutes: 20,
    category: "accuracy",
  },
  {
    id: "big-single-lock",
    name: "Big Single Lock",
    descriptionKey: "training.bigSingleLockDesc",
    icon: Lock,
    difficulty: "intermediate",
    durationMinutes: 15,
    category: "accuracy",
  },
  {
    id: "random-score",
    name: "Random Score",
    descriptionKey: "training.randomScoreDesc",
    icon: Shuffle,
    difficulty: "intermediate",
    durationMinutes: 10,
    category: "accuracy",
  },
  {
    id: "bull-control",
    name: "Bull Control",
    descriptionKey: "training.bullControlDesc",
    icon: Crosshair,
    difficulty: "pro",
    durationMinutes: 25,
    category: "pressure",
  },
  {
    id: "shanghai",
    name: "Shanghai",
    descriptionKey: "training.shanghaiDesc",
    icon: PartyPopper,
    difficulty: "pro",
    durationMinutes: 15,
    category: "pressure",
  },
  {
    id: "halve-it",
    name: "Halve It",
    descriptionKey: "training.halveItDesc",
    icon: Divide,
    difficulty: "intermediate",
    durationMinutes: 15,
    category: "pressure",
  },
  {
    id: "bobs-27",
    name: "Bob's 27",
    descriptionKey: "training.bobs27Desc",
    icon: ListOrdered,
    difficulty: "pro",
    durationMinutes: 15,
    category: "doubles",
  },
  {
    id: "shanghai-rtc",
    name: "Shanghai Round the Clock",
    descriptionKey: "training.shanghaiRtcDesc",
    icon: Route,
    difficulty: "pro",
    durationMinutes: 20,
    category: "pressure",
  },
];

interface HalveItRound {
  labelKey: string;
  kind: "number" | "anyDouble" | "anyTriple" | "bull";
  number?: number;
}
/** 10-round Halve It sequence — mixes fixed numbers with "any double/triple/bull" rounds,
 *  the way it's traditionally chalked up on a pub blackboard. */
const HALVE_IT_ROUNDS: HalveItRound[] = [
  { labelKey: "20", kind: "number", number: 20 },
  { labelKey: "training.anyDouble", kind: "anyDouble" },
  { labelKey: "19", kind: "number", number: 19 },
  { labelKey: "18", kind: "number", number: 18 },
  { labelKey: "game.bull", kind: "bull" },
  { labelKey: "17", kind: "number", number: 17 },
  { labelKey: "training.anyTriple", kind: "anyTriple" },
  { labelKey: "16", kind: "number", number: 16 },
  { labelKey: "15", kind: "number", number: 15 },
  { labelKey: "training.anyDouble", kind: "anyDouble" },
];
const HALVE_IT_START = 40;
const BOBS_27_ROUNDS = 20;

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-secondary/20 text-secondary",
  intermediate: "bg-primary/20 text-primary",
  pro: "bg-accent/20 text-accent",
};

const DIFFICULTY_LABEL_KEY: Record<string, string> = {
  beginner: "training.difficultyBeginner",
  intermediate: "training.difficultyIntermediate",
  pro: "training.difficultyPro",
};

/** Double fields for doubles-only drill */
const DOUBLE_TARGETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25];

/** Single targets for Big Single Lock (ascending 1 → 20) */
const BIG_SINGLE_TARGETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** Pressure checkout values */
const PRESSURE_CHECKOUTS = [32, 40, 16, 36, 24, 8, 20, 50, 64, 80];

const BULL_CONTROL_MAX_PLAYERS = 8;

/** Every remaining score actually achievable in 3 darts ending on a double — a uniform 2-170
 *  random pick (the previous implementation) hands out 162/163/165/166/168/169 as often as any
 *  real target, but none of those are checkoutable at all under double-out, so a "random finish"
 *  drill could assign an unwinnable practice target. */
const VALID_CHECKOUTS = Object.keys(CHECKOUT_ROUTES).map(Number);

/** Generates a random checkout that's actually achievable in 3 darts. */
function randomCheckout(): number {
  return VALID_CHECKOUTS[Math.floor(Math.random() * VALID_CHECKOUTS.length)];
}

// ─── personal records ──────────────────────────────────────────────
// Device-local (not synced to an account — training drills are practice reps, not recorded
// games) best result per drill, so recurring practice has something to actually chase. Only
// drills with a genuinely comparable single-number outcome get one (see computeRecordCandidate);
// bull-control is inherently multiplayer/competitive and has no "your" record to speak of.
interface RecordEntry {
  value: number;
  higherIsBetter: boolean;
  label: string;
  achievedAt: string;
}

/** Target Grind's round count is player-configurable, which makes its raw hit-rate % record
 *  unfair to compare as one bucket — a lucky 5-round 100% shouldn't overwrite a much harder
 *  sustained 30-round 93%. Segmenting the record by round count keeps each comparison apples-to-
 *  apples; every other recordable drill is either fixed-length or gated by `completedFully`, so
 *  no variant is needed for them. */
function recordVariant(drillId: string, ctx: { maxRounds?: number; rtcStart?: number; targetBase?: number; targetMul?: number }): string | undefined {
  // Round count alone used to be the whole key — a trivial-target run (e.g. Single-1) hitting
  // 93% at 10 rounds would overwrite a genuinely hard T20 record at the same round count, since
  // both hashed to the same variant. Which target was actually practiced matters at least as much
  // as how many rounds, so it's part of the key too now.
  if (drillId === "target-grind") return `${ctx.targetMul ?? 3}x${ctx.targetBase ?? 20}:${ctx.maxRounds ?? 10}`;
  // Shanghai RTC's difficulty depends on BOTH where it starts (fewer numbers left from 20) and
  // whether a round cap is set — a 5-round-capped run starting at 19 (just 2 numbers) isn't a
  // fair comparison against an uncapped full run from 1, so both go into the variant key.
  if (drillId === "shanghai-rtc") return `${ctx.rtcStart ?? 1}-${ctx.maxRounds ?? "open"}`;
  return undefined;
}

const recordKey = (drillId: string, variant?: string) => `training-record-${drillId}${variant ? `:${variant}` : ""}`;

function loadRecord(drillId: string, variant?: string): RecordEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(recordKey(drillId, variant));
    return raw ? (JSON.parse(raw) as RecordEntry) : null;
  } catch {
    return null;
  }
}

function saveRecord(drillId: string, entry: RecordEntry, variant?: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(recordKey(drillId, variant), JSON.stringify(entry));
}

// ─── attempt history (trend) ──────────────────────────────────────
// Same device-local storage as the record above (see its own comment for why) — this just adds
// what the record alone can't show: whether you're actually trending better lately, not only
// "is this the best you've ever done." Every fair/comparable completed run counts, not just the
// ones that broke the record — same computeRecordCandidate gate as saveRecord uses.
export interface HistoryEntry {
  value: number;
  achievedAt: string;
}

const HISTORY_LIMIT = 15;
const historyKey = (drillId: string, variant?: string) => `training-history-${drillId}${variant ? `:${variant}` : ""}`;

function loadHistory(drillId: string, variant?: string): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(historyKey(drillId, variant));
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Appends one attempt, oldest-first, capped to the most recent HISTORY_LIMIT — an unbounded log
 *  would grow forever for a drill someone practices daily. Returns the updated list so the
 *  caller can set state from the same value it just persisted. */
function pushHistoryEntry(drillId: string, entry: HistoryEntry, variant?: string): HistoryEntry[] {
  const next = [...loadHistory(drillId, variant), entry].slice(-HISTORY_LIMIT);
  if (typeof window !== "undefined") window.localStorage.setItem(historyKey(drillId, variant), JSON.stringify(next));
  return next;
}

/** Given a FINISHED drill state, returns the comparable result for this run, or null if this
 *  particular run doesn't produce one (e.g. a round-cappable drill cut short before actually
 *  reaching the end — see `completedFully` — isn't a fair "how fast can you finish" data point). */
function computeRecordCandidate(drillId: string, state: DrillState, t: (key: string) => string): Omit<RecordEntry, "achievedAt"> | null {
  switch (drillId) {
    case "around-the-clock":
    case "doubles-only":
    case "big-single-lock":
      return state.completedFully ? { value: state.dartsThrown, higherIsBetter: false, label: t("training.recordDartsToComplete") } : null;
    case "121-challenge":
      return state.remaining === 0 ? { value: state.dartsThrown, higherIsBetter: false, label: t("training.recordDartsToCheckout") } : null;
    case "pressure-training":
    case "random-finish":
      return { value: state.dartsThrown, higherIsBetter: false, label: t("training.recordDartsForAllCheckouts") };
    case "target-grind":
    case "random-score":
      return state.dartsThrown > 0
        ? { value: Math.round((state.hits / state.dartsThrown) * 100), higherIsBetter: true, label: t("training.recordHitRatePercent") }
        : null;
    case "shanghai":
      return { value: state.shanghaiScore ?? 0, higherIsBetter: true, label: t("training.recordShanghaiScore") };
    case "shanghai-rtc":
      return { value: state.rtcScore ?? 0, higherIsBetter: true, label: t("training.recordScore") };
    case "halve-it":
      return { value: state.remaining, higherIsBetter: true, label: t("training.recordFinalScore") };
    case "bobs-27":
      return { value: Math.max(0, state.remaining), higherIsBetter: true, label: t("training.recordFinalScore") };
    default:
      return null;
  }
}

/** Generates a random random-score target: {base, mul, label} */
function randomTarget(t: (key: string) => string): { base: number; mul: number; label: string } {
  const roll = Math.random();
  if (roll < 0.15) {
    // Bull / Bullseye
    return Math.random() < 0.5
      ? { base: 25, mul: 1, label: `${t("game.bull")} (25)` }
      : { base: 25, mul: 2, label: `${t("game.bullseye")} (50)` };
  }
  const base = Math.floor(Math.random() * 20) + 1;
  const mulRoll = Math.random();
  if (mulRoll < 0.55) return { base, mul: 1, label: `S${base}` };
  if (mulRoll < 0.85) return { base, mul: 2, label: `D${base}` };
  return { base, mul: 3, label: `T${base}` };
}

/** Active drill state */
interface DrillState {
  drillId: string;
  dartsThrown: number;
  dartsThisRound: number;
  hits: number;
  hitsThisRound: number;
  currentTarget: number;
  targetList: number[];
  targetIndex: number;
  remaining: number; // for checkout drills
  finished: boolean;
  roundScores: number[]; // per-round scores for summary
  /** Big Single Lock: index of the last locked segment (or -1) */
  lockedIndex?: number;
  /** Configurable round cap for endless drills */
  maxRounds?: number;
  roundsPlayed?: number;
  /** Target Grind: chosen target multiplier & base */
  targetBase?: number;
  targetMul?: number;
  /** Random Score: current random target label + spec */
  randomBase?: number;
  randomMul?: number;
  randomLabel?: string;
  /** Bull Control: players, whose turn it is and who currently owns the scoring licence */
  bcPlayers?: { name: string; remaining: number }[];
  bcTurn?: number;
  bcScorer?: number;
  bcNumber?: number;
  bcWinner?: string;
  /** Shanghai: multipliers (1/2/3) hit on the current number so far this round, and running score */
  shanghaiMultsHit?: number[];
  shanghaiScore?: number;
  shanghaiWin?: boolean;
  /** Shanghai Round the Clock: which of Single(1)/Triple(3) were hit THIS TURN — resets whenever
   *  a turn ends without hitting the finishing double (see rtcMissedAt below), so completing the
   *  double always requires Single+Triple within the same 3-dart visit. Drives the UI pills and
   *  the finishing-double gate check ONLY — never gates scoring, see rtcScoredMults. */
  rtcMultsHit?: number[];
  /** Which of Single(1)/Triple(3) have ever been SCORED for the CURRENT number, persisting
   *  across turns until the number is actually completed (only cleared on advance). Separate
   *  from rtcMultsHit specifically so a reset-for-missing-the-finish turn can't let the same
   *  Single/Triple pay out again next turn — that was scoring the same hit twice. */
  rtcScoredMults?: number[];
  rtcScore?: number;
  rtcWin?: boolean;
  /** Increments every time progress on the current number becomes newly unrecoverable — a
   *  counter (not a boolean) so the UI can key an animation off it and re-flash even if it fires
   *  on back-to-back turns. */
  rtcMissedAt?: number;
  /** Halve It: points accumulated so far this round (reset each round; `remaining` is the running score) */
  hiRoundPoints?: number;
  /** True only when a round-cappable drill (around-the-clock, doubles-only, big-single-lock)
   *  actually reached the end of its target list — as opposed to `finished` becoming true because
   *  the optional round limit ran out first. Personal-record tracking only counts the former;
   *  a session cut short by the round cap isn't a comparable "how fast can you finish" result. */
  completedFully?: boolean;
}

/** Pre-start configuration for a drill */
interface DrillConfig {
  maxRounds?: number;
  targetBase?: number;
  targetMul?: number;
  bcPlayerNames?: string[];
  bcNumber?: number;
  bcStart?: number;
  /** Shanghai Round the Clock: which number (1-20) to start the sequence at. */
  rtcStart?: number;
}

const TrainingPage = () => {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { club } = useClubBranding();
  const [selectedDrill, setSelectedDrill] = useState<TrainingDrill | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [drillState, setDrillState] = useState<DrillState | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [drillConfig, setDrillConfig] = useState<DrillConfig>({});
  const [currentRecord, setCurrentRecord] = useState<RecordEntry | null>(null);
  const [brokeRecord, setBrokeRecord] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [rtcFlash, setRtcFlash] = useState(false);
  const [undoStack, setUndoStack] = useState<DrillState[]>([]);

  // Shanghai Round the Clock: brief visible feedback the instant progress becomes unrecoverable,
  // instead of only a silent state reset the player might not notice until the next dart.
  useEffect(() => {
    if (!drillState?.rtcMissedAt) return;
    setRtcFlash(true);
    const t = window.setTimeout(() => setRtcFlash(false), 700);
    return () => window.clearTimeout(t);
  }, [drillState?.rtcMissedAt]);

  // Load whatever's on record for this drill as soon as it's picked (needed on both the
  // pre-start screen and the finished-summary screen). Also reacts to the round-cap picker for
  // Target Grind, so the shown record tracks whichever variant is currently selected.
  useEffect(() => {
    const variant = selectedDrill ? recordVariant(selectedDrill.id, { maxRounds: drillConfig.maxRounds, rtcStart: drillConfig.rtcStart, targetBase: drillConfig.targetBase, targetMul: drillConfig.targetMul }) : undefined;
    setCurrentRecord(selectedDrill ? loadRecord(selectedDrill.id, variant) : null);
    setHistory(selectedDrill ? loadHistory(selectedDrill.id, variant) : []);
  }, [selectedDrill, drillConfig.maxRounds, drillConfig.rtcStart, drillConfig.targetBase, drillConfig.targetMul]);

  // Compare + persist the instant a run finishes.
  useEffect(() => {
    if (!selectedDrill || !drillState?.finished) return;
    const candidate = computeRecordCandidate(selectedDrill.id, drillState, t);
    if (!candidate) {
      setBrokeRecord(false);
      return;
    }
    const variant = recordVariant(selectedDrill.id, { maxRounds: drillState.maxRounds, rtcStart: drillState.targetList?.[0], targetBase: drillState.targetBase, targetMul: drillState.targetMul });
    const achievedAt = new Date().toISOString();
    setHistory(pushHistoryEntry(selectedDrill.id, { value: candidate.value, achievedAt }, variant));
    const existing = loadRecord(selectedDrill.id, variant);
    const isNew = !existing || (candidate.higherIsBetter ? candidate.value > existing.value : candidate.value < existing.value);
    if (isNew) {
      const entry: RecordEntry = { ...candidate, achievedAt };
      saveRecord(selectedDrill.id, entry, variant);
      setCurrentRecord(entry);
      setBrokeRecord(true);
    } else {
      setBrokeRecord(false);
    }
  }, [drillState, selectedDrill, t]);

  const categories = [
    { key: "all", label: t("training.categoryAll") },
    { key: "doubles", label: t("training.categoryDoubles") },
    { key: "finishing", label: t("training.categoryFinishing") },
    { key: "accuracy", label: t("training.categoryAccuracy") },
    { key: "pressure", label: t("training.categoryPressure") },
  ];

  const filteredDrills = filterCategory === "all"
    ? TRAINING_DRILLS
    : TRAINING_DRILLS.filter((d) => d.category === filterCategory);

  /** Start an active drill session */
  const startDrill = (drill: TrainingDrill, config: DrillConfig = drillConfig) => {
    setBrokeRecord(false);
    setRtcFlash(false);
    setUndoStack([]);
    const state: DrillState = {
      drillId: drill.id,
      dartsThrown: 0,
      dartsThisRound: 0,
      hits: 0,
      hitsThisRound: 0,
      currentTarget: 0,
      targetList: [],
      targetIndex: 0,
      remaining: 0,
      finished: false,
      roundScores: [],
      roundsPlayed: 0,
      maxRounds: config.maxRounds,
    };

    switch (drill.id) {
      case "around-the-clock":
        state.targetList = Array.from({ length: 20 }, (_, i) => i + 1);
        state.currentTarget = 1;
        break;
      case "doubles-only":
        state.targetList = [...DOUBLE_TARGETS];
        state.currentTarget = DOUBLE_TARGETS[0];
        break;
      case "121-challenge":
        state.remaining = 121;
        state.currentTarget = 121;
        break;
      case "pressure-training":
        state.targetList = [...PRESSURE_CHECKOUTS];
        state.currentTarget = PRESSURE_CHECKOUTS[0];
        state.remaining = PRESSURE_CHECKOUTS[0];
        break;
      case "random-finish": {
        const val = randomCheckout();
        state.remaining = val;
        state.currentTarget = val;
        break;
      }
      case "target-grind": {
        const base = config.targetBase ?? 20;
        const mul = config.targetMul ?? 3;
        state.targetBase = base;
        state.targetMul = mul;
        state.currentTarget = base * mul;
        state.maxRounds = config.maxRounds ?? 10;
        break;
      }
      case "big-single-lock":
        state.targetList = [...BIG_SINGLE_TARGETS];
        state.currentTarget = BIG_SINGLE_TARGETS[0];
        state.lockedIndex = -1;
        break;
      case "random-score": {
        const randTarget = randomTarget(t);
        state.randomBase = randTarget.base;
        state.randomMul = randTarget.mul;
        state.randomLabel = randTarget.label;
        state.maxRounds = 10;
        break;
      }
      case "shanghai":
        state.targetList = Array.from({ length: 20 }, (_, i) => i + 1);
        state.currentTarget = 1;
        state.shanghaiScore = 0;
        state.shanghaiMultsHit = [];
        break;
      case "shanghai-rtc": {
        const start = Math.min(20, Math.max(1, config.rtcStart ?? 1));
        state.targetList = Array.from({ length: 20 - start + 1 }, (_, i) => start + i);
        state.currentTarget = start;
        state.rtcScore = 0;
        state.rtcMultsHit = [];
        state.rtcScoredMults = [];
        state.maxRounds = config.maxRounds;
        break;
      }
      case "halve-it":
        state.remaining = HALVE_IT_START;
        state.hiRoundPoints = 0;
        state.targetIndex = 0;
        break;
      case "bobs-27":
        state.remaining = 27;
        state.targetIndex = 0; // round number = targetIndex + 1
        break;
      case "bull-control": {
        const names = (config.bcPlayerNames && config.bcPlayerNames.length >= 2
          ? config.bcPlayerNames
          : [`${t("stats.player")} 1`, `${t("stats.player")} 2`]).map((n, i) => n.trim() || `${t("stats.player")} ${i + 1}`);
        const start = config.bcStart ?? 301;
        state.bcPlayers = names.map((name) => ({ name, remaining: start }));
        state.bcTurn = 0;
        state.bcScorer = -1;
        state.bcNumber = config.bcNumber ?? 20;
        break;
      }
    }

    setDrillState(state);
  };

  /** Process a single dart (from manual input or camera) in the active drill */
  const processDart = useCallback((scoreValue: number, mul: number) => {
    if (!selectedDrill) return;
    const points = scoreValue === 25 && mul === 3 ? 0 : scoreValue * mul;
    const baseValue = scoreValue === 50 ? 25 : scoreValue;

    setDrillState((prev) => {
      if (!prev || prev.finished) return prev;
      const newDartsThisRound = prev.dartsThisRound + 1;
      const updated = { ...prev, dartsThrown: prev.dartsThrown + 1, dartsThisRound: newDartsThisRound };

      switch (selectedDrill.id) {
        case "around-the-clock": {
          // Hit the current target number (any multiplier)
          if (baseValue === prev.currentTarget) {
            updated.hits++;
            const nextIdx = prev.targetIndex + 1;
            if (nextIdx >= prev.targetList.length) {
              updated.finished = true;
              updated.completedFully = true;
            } else {
              updated.targetIndex = nextIdx;
              updated.currentTarget = prev.targetList[nextIdx];
            }
          }
          break;
        }

        case "doubles-only": {
          // Must hit the double of the current target
          if (baseValue === prev.currentTarget && mul === 2) {
            updated.hits++;
            const nextIdx = prev.targetIndex + 1;
            if (nextIdx >= prev.targetList.length) {
              updated.finished = true;
              updated.completedFully = true;
            } else {
              updated.targetIndex = nextIdx;
              updated.currentTarget = prev.targetList[nextIdx];
            }
          }
          break;
        }

        case "121-challenge": {
          const newRemaining = prev.remaining - points;
          if (newRemaining < 0 || newRemaining === 1) {
            // Bust — already certain this visit can't check out, reset right away instead of
            // making the player throw out the rest of a visit that no longer matters.
            updated.dartsThisRound = 0;
            updated.remaining = prev.remaining;
          } else if (newRemaining === 0) {
            updated.remaining = 0;
            updated.finished = true;
            updated.hits++;
          } else {
            updated.remaining = newRemaining;
            updated.currentTarget = newRemaining;
            // Unlike a bust, surviving a visit without checking out isn't an error — this is a
            // continuous countdown, so `remaining` keeps counting down for real. But the per-visit
            // dart counter still needs to reset at the 3-dart boundary like every other drill's,
            // or it grows unbounded across visits (breaks the 3-dot counter display and the
            // camera's dartsRemaining tracking, which derives from it).
            if (newDartsThisRound >= 3) updated.dartsThisRound = 0;
          }
          break;
        }

        case "pressure-training": {
          const newRemaining = prev.remaining - points;
          if (newRemaining === 0) {
            updated.hits++;
            const nextIdx = prev.targetIndex + 1;
            if (nextIdx >= prev.targetList.length) {
              updated.finished = true;
            } else {
              updated.targetIndex = nextIdx;
              updated.currentTarget = prev.targetList[nextIdx];
              updated.remaining = prev.targetList[nextIdx];
            }
            updated.dartsThisRound = 0;
          } else if (newRemaining < 0 || newRemaining === 1) {
            // Bust — already certain, reset right away instead of waiting out the rest of this visit
            updated.remaining = prev.targetList[prev.targetIndex];
            updated.dartsThisRound = 0;
          } else {
            updated.remaining = newRemaining;
            if (newDartsThisRound >= 3) {
              // Failed to check out in 3 darts, reset
              updated.remaining = prev.targetList[prev.targetIndex];
              updated.dartsThisRound = 0;
            }
          }
          break;
        }

        case "random-finish": {
          const newRemaining = prev.remaining - points;
          if (newRemaining === 0) {
            updated.hits++;
            // Generate next random checkout
            const next = randomCheckout();
            updated.remaining = next;
            updated.currentTarget = next;
            updated.dartsThisRound = 0;
            // After 10 successful checkouts, finish
            if (updated.hits >= 10) {
              updated.finished = true;
            }
          } else if (newRemaining < 0 || newRemaining === 1) {
            // Bust — already certain, reset right away instead of waiting out the rest of this visit
            const next = randomCheckout();
            updated.remaining = next;
            updated.currentTarget = next;
            updated.dartsThisRound = 0;
          } else {
            updated.remaining = newRemaining;
            if (newDartsThisRound >= 3) {
              const next = randomCheckout();
              updated.remaining = next;
              updated.currentTarget = next;
              updated.dartsThisRound = 0;
            }
          }
          break;
        }

        case "target-grind": {
          // Count hits on chosen target across configured rounds
          if (
            baseValue === (prev.targetBase ?? 20) &&
            mul === (prev.targetMul ?? 3)
          ) {
            updated.hits++;
          }
          updated.roundScores = [...(prev.roundScores || []), points];
          const totalDarts = (prev.maxRounds ?? 10) * 3;
          if (updated.dartsThrown >= totalDarts) {
            updated.finished = true;
          }
          break;
        }

        case "big-single-lock": {
          // Count single hits on the current target within the 3-dart round
          if (baseValue === prev.currentTarget && mul === 1) {
            updated.hits++;
            updated.hitsThisRound = prev.hitsThisRound + 1;
          }
          updated.roundScores = [...(prev.roundScores || []), points];
          break;
        }

        case "random-score": {
          if (
            baseValue === (prev.randomBase ?? 0) &&
            mul === (prev.randomMul ?? 0)
          ) {
            updated.hits++;
            updated.hitsThisRound = prev.hitsThisRound + 1;
          }
          updated.roundScores = [...(prev.roundScores || []), points];
          break;
        }

        case "shanghai": {
          const targetNum = prev.currentTarget;
          if (baseValue === targetNum) {
            const multsHit = new Set(prev.shanghaiMultsHit ?? []);
            multsHit.add(mul);
            updated.shanghaiMultsHit = Array.from(multsHit);
            updated.shanghaiScore = (prev.shanghaiScore ?? 0) + points;
            updated.hits = prev.hits + 1;
            if (multsHit.has(1) && multsHit.has(2) && multsHit.has(3)) {
              updated.finished = true;
              updated.shanghaiWin = true;
            }
          }
          updated.roundScores = [...(prev.roundScores || []), baseValue === targetNum ? points : 0];
          break;
        }

        case "shanghai-rtc": {
          const targetNum = prev.currentTarget;
          // Two separate trackers on purpose:
          // - rtcMultsHit is TURN-scoped (resets whenever a turn ends without the finishing
          //   double — see the reset check below) and only gates whether a double counts as the
          //   finisher: Single+Triple must land within the same 3-dart visit as the Double.
          // - rtcScoredMults is NUMBER-scoped and never resets on a missed turn (only on
          //   advancing to the next number) — it's what actually gates scoring, so a Single that
          //   already scored once for this number can't score again just because a later turn's
          //   reset wiped rtcMultsHit. Without this split, camping on a number across MULTIPLE
          //   turns re-inflates the score exactly the way a single turn used to.
          let scoreDelta = 0;
          if (baseValue === targetNum) {
            if (mul === 1 || mul === 3) {
              const turnHit = new Set(prev.rtcMultsHit ?? []);
              turnHit.add(mul);
              updated.rtcMultsHit = Array.from(turnHit);
              const scored = new Set(prev.rtcScoredMults ?? []);
              if (!scored.has(mul)) {
                scoreDelta = points;
                scored.add(mul);
                updated.rtcScoredMults = Array.from(scored);
                updated.hits = prev.hits + 1;
              }
            } else if (mul === 2) {
              const turnHit = new Set(prev.rtcMultsHit ?? []);
              if (turnHit.has(1) && turnHit.has(3)) {
                // Finishing double after both Single and Triple landed THIS turn — advance right
                // away, same immediate-advance-on-hit style as Around the Clock, not tied to a
                // 3-dart turn boundary.
                scoreDelta = points;
                updated.hits = prev.hits + 1;
                updated.rtcMultsHit = [];
                updated.rtcScoredMults = [];
                const nextIdx = prev.targetIndex + 1;
                if (nextIdx >= prev.targetList.length) {
                  updated.finished = true;
                  updated.rtcWin = true;
                } else {
                  updated.targetIndex = nextIdx;
                  updated.currentTarget = prev.targetList[nextIdx];
                }
              }
              // Double hit before Single+Triple are both done this turn doesn't count as the
              // finisher — and doesn't score either.
            }
          }
          updated.rtcScore = (prev.rtcScore ?? 0) + scoreDelta;
          updated.roundScores = [...(prev.roundScores || []), scoreDelta];
          // As soon as finishing this number within the current turn becomes mathematically
          // impossible — not enough darts left in this turn for whatever's still missing among
          // Single/Triple/the finishing Double — reset right away instead of waiting for the 3rd
          // dart. A 1st-dart miss already needs all 3 remaining darts it doesn't have; a miss
          // right after a Single already needs 2 (Triple + Double) with only 1 dart left, etc.
          // Only rtcMultsHit (this turn's progress) resets here — rtcScoredMults (what's already
          // been paid out for this number) is untouched, so retrying next turn can't double-score.
          if (!updated.finished && updated.targetIndex === prev.targetIndex) {
            const turnHit = updated.rtcMultsHit ?? [];
            const stillNeeded = (turnHit.includes(1) ? 0 : 1) + (turnHit.includes(3) ? 0 : 1) + 1; // +1 for the finishing double itself
            const dartsLeftThisTurn = 3 - newDartsThisRound;
            if (stillNeeded > dartsLeftThisTurn) {
              updated.rtcMultsHit = [];
              updated.rtcMissedAt = (prev.rtcMissedAt ?? 0) + 1;
            }
          }
          break;
        }

        case "halve-it": {
          const round = HALVE_IT_ROUNDS[prev.targetIndex] ?? HALVE_IT_ROUNDS[0];
          const matches = round.kind === "number" ? baseValue === round.number
            : round.kind === "anyDouble" ? mul === 2 && baseValue !== 0
            : round.kind === "anyTriple" ? mul === 3 && baseValue !== 0
            : baseValue === 25; // bull
          if (matches) {
            updated.hiRoundPoints = (prev.hiRoundPoints ?? 0) + points;
            updated.hits = prev.hits + 1;
          }
          updated.roundScores = [...(prev.roundScores || []), matches ? points : 0];
          break;
        }

        case "bobs-27": {
          const roundNumber = prev.targetIndex + 1;
          const isDoubleHit = baseValue === roundNumber && mul === 2;
          if (isDoubleHit) {
            updated.remaining = prev.remaining + points;
            updated.hits = prev.hits + 1;
            updated.hitsThisRound = prev.hitsThisRound + 1;
          }
          updated.roundScores = [...(prev.roundScores || []), isDoubleHit ? points : 0];
          break;
        }

        case "bull-control": {
          const players = (prev.bcPlayers || []).map((p) => ({ ...p }));
          const turn = prev.bcTurn ?? 0;
          const number = prev.bcNumber ?? 20;
          if (baseValue === 25) {
            // Bull steals the scoring licence
            updated.bcScorer = turn;
            updated.hits++;
          } else if (baseValue === number && (prev.bcScorer ?? -1) === turn) {
            const rest = players[turn].remaining - points;
            if (rest > 0) {
              players[turn].remaining = rest;
              updated.hits++;
            } else if (rest === 0) {
              players[turn].remaining = 0;
              updated.hits++;
              updated.finished = true;
              updated.bcWinner = players[turn].name;
            }
            // bust (rest < 0) → dart simply does not count
          }
          updated.bcPlayers = players;
          updated.roundScores = [...(prev.roundScores || []), points];
          break;
        }
      }

      // End of round handling
      if (newDartsThisRound >= 3 && !["pressure-training", "random-finish", "121-challenge"].includes(selectedDrill.id)) {
        updated.dartsThisRound = 0;
        updated.roundsPlayed = (prev.roundsPlayed ?? 0) + 1;

        // Bull Control: hand over to the next player
        if (selectedDrill.id === "bull-control" && !updated.finished) {
          const count = (updated.bcPlayers || []).length || 1;
          updated.bcTurn = ((prev.bcTurn ?? 0) + 1) % count;
          updated.hitsThisRound = 0;
        }

        // Big Single Lock: evaluate hits this round
        if (selectedDrill.id === "big-single-lock") {
          const hitsRound = updated.hitsThisRound;
          const locked = prev.lockedIndex ?? -1;
          const len = prev.targetList.length;
          let nextIdx = prev.targetIndex;
          let nextLocked = locked;
          if (hitsRound >= 3) {
            // Lock current, advance
            nextLocked = prev.targetIndex;
            nextIdx = Math.min(prev.targetIndex + 1, len - 1);
            if (prev.targetIndex >= len - 1) { updated.finished = true; updated.completedFully = true; }
          } else if (hitsRound === 2) {
            // Advance without locking
            nextIdx = Math.min(prev.targetIndex + 1, len - 1);
            if (prev.targetIndex >= len - 1) { updated.finished = true; updated.completedFully = true; }
          } else if (hitsRound <= 1) {
            // Fall back to last locked segment (or stay at start)
            nextIdx = locked >= 0 ? locked : 0;
          }
          updated.targetIndex = nextIdx;
          updated.currentTarget = prev.targetList[nextIdx];
          updated.lockedIndex = nextLocked;
          updated.hitsThisRound = 0;
        }

        // Shanghai: advance to the next number (1 → 20), unless already won this round
        if (selectedDrill.id === "shanghai" && !updated.finished) {
          const nextIdx = prev.targetIndex + 1;
          updated.shanghaiMultsHit = [];
          if (nextIdx >= prev.targetList.length) {
            updated.finished = true;
          } else {
            updated.targetIndex = nextIdx;
            updated.currentTarget = prev.targetList[nextIdx];
          }
        }


        // Halve It: no hit this round → halve the running score; otherwise add it. Advance
        // through the 10 fixed rounds, ending the drill after the last one.
        if (selectedDrill.id === "halve-it") {
          const roundPts = updated.hiRoundPoints ?? 0;
          updated.remaining = roundPts > 0 ? prev.remaining + roundPts : Math.floor(prev.remaining / 2);
          updated.hiRoundPoints = 0;
          const nextIdx = prev.targetIndex + 1;
          if (nextIdx >= HALVE_IT_ROUNDS.length) {
            updated.finished = true;
          } else {
            updated.targetIndex = nextIdx;
          }
        }

        // Bob's 27: no double hit this round → subtract its value; busting to 0 ends the
        // drill early, otherwise it runs through all 20 numbers.
        if (selectedDrill.id === "bobs-27") {
          const roundNumber = prev.targetIndex + 1;
          if ((updated.hitsThisRound ?? 0) === 0) {
            updated.remaining = prev.remaining - roundNumber * 2;
          }
          updated.hitsThisRound = 0;
          if (updated.remaining <= 0) {
            updated.finished = true;
          } else {
            const nextIdx = prev.targetIndex + 1;
            if (nextIdx >= BOBS_27_ROUNDS) {
              updated.finished = true;
            } else {
              updated.targetIndex = nextIdx;
            }
          }
        }

        // Random Score: draw new target
        if (selectedDrill.id === "random-score") {
          const randTarget = randomTarget(t);
          updated.randomBase = randTarget.base;
          updated.randomMul = randTarget.mul;
          updated.randomLabel = randTarget.label;
          updated.hitsThisRound = 0;
          if ((updated.roundsPlayed ?? 0) >= (prev.maxRounds ?? 10)) {
            updated.finished = true;
          }
        }

        // Generic round cap for endless drills
        if (
          !updated.finished &&
          prev.maxRounds &&
          (updated.roundsPlayed ?? 0) >= prev.maxRounds &&
          ["around-the-clock", "doubles-only", "big-single-lock", "shanghai-rtc"].includes(selectedDrill.id)
        ) {
          updated.finished = true;
        }
      }

      return updated;
    });
  }, [selectedDrill, t]);

  /** Snapshot drillState onto the undo stack right before a mutation — mirrors Game.tsx's
   *  saveUndo(), called from each entry point (manual pad, camera round, quick-round) rather than
   *  from inside processDart itself, since processDart only ever reads `prev` via the setDrillState
   *  updater and never closes over the `drillState` variable directly (needed so a camera round's
   *  several processDart calls in one tick don't each see a stale pre-round value) — reading
   *  `drillState` here instead, once per user action, is exactly where a fresh value is available. */
  const pushUndo = useCallback(() => {
    if (!drillState || drillState.finished) return;
    setUndoStack((prev) => [...prev, JSON.parse(JSON.stringify(drillState))]);
  }, [drillState]);

  const handleDrillThrow = useCallback((base: number, mul: number) => {
    pushUndo();
    processDart(base, mul);
  }, [pushUndo, processDart]);

  const handleCameraRound = useCallback((darts: DetectedDart[]) => {
    pushUndo();
    darts.forEach((d) => processDart(d.baseValue, d.multiplier));
  }, [pushUndo, processDart]);

  /** Submit a whole 3-dart visit as one total (quick-preset grid, typed total, or voice — all of
   *  DartScoreInput's onQuickRound). Only offered for the 3 checkout-style drills (see
   *  CHECKOUT_DRILL_IDS). Deliberately NOT implemented as "split into 3 fake darts and feed them
   *  through processDart one at a time" the way Game.tsx's splitQuickRound does — that trick exists
   *  there because game_legs.throws persists individual darts for later per-dart stats, so Game.tsx
   *  needs a plausible-looking breakdown. Training never persists per-dart detail, and an arbitrary
   *  3-way split of the total can cross zero (or land on 1) at a fake intermediate dart that has
   *  nothing to do with whether the REAL total busts against the current remaining — e.g. splitting
   *  60 into 20+20+20 against a remaining of 40 would falsely check out after two synthetic darts.
   *  Resolving bust/checkout once, for the total against remaining, matches every other
   *  quick-round-shaped drill in real darts and can't produce that artifact. */
  const handleQuickRound = (total: number) => {
    if (!selectedDrill || !CHECKOUT_DRILL_IDS.includes(selectedDrill.id) || !isAchievableVisitTotal(total)) return;
    if (!drillState || drillState.finished) return;
    pushUndo();
    setDrillState((prev) => {
      if (!prev || prev.finished) return prev;
      const updated = { ...prev, dartsThrown: prev.dartsThrown + 3, dartsThisRound: 0 };
      const newRemaining = prev.remaining - total;
      switch (selectedDrill.id) {
        case "121-challenge": {
          if (newRemaining < 0 || newRemaining === 1) {
            updated.remaining = prev.remaining;
          } else if (newRemaining === 0) {
            updated.remaining = 0;
            updated.finished = true;
            updated.hits = prev.hits + 1;
          } else {
            updated.remaining = newRemaining;
            updated.currentTarget = newRemaining;
          }
          break;
        }
        case "pressure-training": {
          if (newRemaining === 0) {
            updated.hits = prev.hits + 1;
            const nextIdx = prev.targetIndex + 1;
            if (nextIdx >= prev.targetList.length) {
              updated.finished = true;
            } else {
              updated.targetIndex = nextIdx;
              updated.currentTarget = prev.targetList[nextIdx];
              updated.remaining = prev.targetList[nextIdx];
            }
          } else {
            updated.remaining = prev.targetList[prev.targetIndex];
          }
          break;
        }
        case "random-finish": {
          if (newRemaining === 0) {
            updated.hits = prev.hits + 1;
            const next = randomCheckout();
            updated.remaining = next;
            updated.currentTarget = next;
            if (updated.hits >= 10) updated.finished = true;
          } else {
            const next = randomCheckout();
            updated.remaining = next;
            updated.currentTarget = next;
          }
          break;
        }
      }
      return updated;
    });
  };

  /** Undo the last dart (or last quick-round visit) — restores the pre-mutation snapshot wholesale. */
  const undoLastDart = () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setDrillState(last);
    setUndoStack((prev) => prev.slice(0, -1));
  };

  const exitDrill = () => {
    setDrillState(null);
    setSelectedDrill(null);
    setUndoStack([]);
    // Otherwise a later drill quick-started from CoachingPlan (which skips the pre-start config
    // screen entirely) silently inherits whatever config an unrelated earlier drill left behind —
    // e.g. a round cap the player never set for the drill they're actually about to play.
    setDrillConfig({});
  };

  const restartDrill = () => {
    if (selectedDrill) startDrill(selectedDrill);
  };

  // ─── ACTIVE DRILL VIEW ────────────────────────────
  if (selectedDrill && drillState) {
    const isCheckoutDrill = CHECKOUT_DRILL_IDS.includes(selectedDrill.id);

    return (
      <div className="container py-6 animate-slide-up max-w-lg mx-auto">
        <Button variant="ghost" onClick={exitDrill} className="mb-4 text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-1" /> {t("common.back")}
        </Button>

        <div className="text-center mb-4">
          <selectedDrill.icon className="w-10 h-10 text-primary mx-auto mb-2" />
          <h2 className="text-xl font-display uppercase">{selectedDrill.name}</h2>
        </div>

        {/* Drill finished overlay */}
        {drillState.finished && (() => {
          const bobsBusted = selectedDrill.id === "bobs-27" && drillState.remaining <= 0;
          return (
          <div className="bg-card border border-primary/30 rounded-2xl p-6 text-center mb-4 glow-cyan animate-scale-in">
            {drillState.shanghaiWin || drillState.rtcWin ? (
              <PartyPopper className="w-12 h-12 text-accent mx-auto mb-3" />
            ) : bobsBusted ? (
              <RotateCcw className="w-12 h-12 text-destructive mx-auto mb-3" />
            ) : (
              <CheckCircle className="w-12 h-12 text-secondary mx-auto mb-3" />
            )}
            <h3 className="text-2xl font-display uppercase mb-2">
              {drillState.shanghaiWin ? t("training.shanghaiWin") : drillState.rtcWin ? t("training.roundTheClockWin") : bobsBusted ? t("training.accountEmpty") : t("training.doneGeneric")}
            </h3>
            {brokeRecord ? (
              <div className="mb-4 rounded-lg border border-accent bg-accent/15 px-3 py-2 text-accent font-display uppercase text-sm flex items-center justify-center gap-2 animate-pulse-glow">
                <Trophy className="w-4 h-4" /> {t("training.newPersonalRecord")}
              </div>
            ) : currentRecord ? (
              <p className="text-xs text-muted-foreground mb-4">
                {t("training.recordLabel")} <span className="text-foreground font-semibold">{currentRecord.value}</span> · {currentRecord.label}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              {selectedDrill.id === "shanghai" ? (
                <div className="bg-card rounded-xl border border-border p-3 col-span-2">
                  <p className="text-2xl font-display">{drillState.shanghaiScore ?? 0}</p>
                  <p className="text-xs text-muted-foreground">
                    {drillState.shanghaiWin ? `${t("training.shanghaiOnNumberRound")} ${drillState.currentTarget}, ${t("tournament.roundLabel")} ${drillState.targetIndex + 1}!` : t("training.scoreAfter20Rounds")}
                  </p>
                </div>
              ) : selectedDrill.id === "shanghai-rtc" ? (
                <div className="bg-card rounded-xl border border-border p-3 col-span-2">
                  <p className="text-2xl font-display">{drillState.rtcWin ? t("training.number20") : drillState.currentTarget}</p>
                  <p className="text-xs text-muted-foreground">
                    {drillState.rtcWin
                      ? `${t("training.allNumbersDone")} ${drillState.rtcScore ?? 0}`
                      : `${t("training.roundLimitReachedAtNumber")} ${drillState.currentTarget} · ${t("training.scoreLabel")} ${drillState.rtcScore ?? 0}`}
                  </p>
                </div>
              ) : selectedDrill.id === "halve-it" ? (
                <div className="bg-card rounded-xl border border-border p-3 col-span-2">
                  <p className="text-2xl font-display">{drillState.remaining}</p>
                  <p className="text-xs text-muted-foreground">{t("training.finalScoreAfter10Rounds")}</p>
                </div>
              ) : selectedDrill.id === "bobs-27" ? (
                <div className="bg-card rounded-xl border border-border p-3 col-span-2">
                  <p className="text-2xl font-display">{Math.max(0, drillState.remaining)}</p>
                  <p className="text-xs text-muted-foreground">
                    {bobsBusted ? `${t("training.bustInRound")} ${drillState.targetIndex + 1}` : t("training.finalScoreAfter20Rounds")}
                  </p>
                </div>
              ) : selectedDrill.id === "bull-control" ? (
                <div className="bg-card rounded-xl border border-border p-3 col-span-2">
                  <p className="text-2xl font-display text-secondary">{drillState.bcWinner ?? "—"}</p>
                  <p className="text-xs text-muted-foreground mb-2">{t("training.winner")}</p>
                  <div className="space-y-1 text-left">
                    {(drillState.bcPlayers ?? []).map((p) => (
                      <div key={p.name} className="flex items-center justify-between text-xs">
                        <span className={p.name === drillState.bcWinner ? "text-secondary font-semibold" : ""}>{p.name}</span>
                        <span className="font-mono">{p.remaining}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="bg-card rounded-xl border border-border p-3">
                    <p className="text-2xl font-display">{drillState.dartsThrown}</p>
                    <p className="text-xs text-muted-foreground">{t("training.dartsThrownLabel")}</p>
                  </div>
                  <div className="bg-card rounded-xl border border-border p-3">
                    <p className="text-2xl font-display">{drillState.hits}</p>
                    <p className="text-xs text-muted-foreground">{t("training.hitsLabel")}</p>
                  </div>
                </>
              )}
              {selectedDrill.id === "target-grind" && (
                <>
                  <div className="bg-card rounded-xl border border-border p-3">
                    <p className="text-2xl font-display">
                      {drillState.dartsThrown > 0 ? Math.round((drillState.hits / drillState.dartsThrown) * 100) : 0}%
                    </p>
                    <p className="text-xs text-muted-foreground">{t("stats.hitRate")}</p>
                  </div>
                  <div className="bg-card rounded-xl border border-border p-3">
                    <p className="text-2xl font-display">
                      {drillState.roundScores.length > 0
                        ? Math.round((drillState.roundScores.reduce((a, b) => a + b, 0) / drillState.roundScores.length) * 3)
                        : 0}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("training.avg3Dart")}</p>
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={restartDrill} variant="outline" className="flex-1 gap-1">
                <RotateCcw className="w-4 h-4" /> {t("training.again")}
              </Button>
              <Button onClick={exitDrill} className="flex-1">
                {t("training.finish")}
              </Button>
            </div>
          </div>
          );
        })()}

        {!drillState.finished && (
          <>
            {/* Drill status info (sticky so it stays visible when the camera is open) */}
            <div className="sticky top-0 z-30 -mx-4 px-4 pt-2 pb-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/40 mb-3">
            <div className="bg-card rounded-xl border border-border p-4 text-center">
              {/* Target display */}
              {selectedDrill.id === "around-the-clock" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{t("training.hitThe")}</p>
                  <p className="text-5xl font-display text-primary">{drillState.currentTarget}</p>
                  <p className="text-xs text-muted-foreground mt-1">{drillState.targetIndex + 1} / {drillState.targetList.length}</p>
                </div>
              )}
              {selectedDrill.id === "doubles-only" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{t("training.hitDouble")}</p>
                  <p className="text-5xl font-display text-primary">D{drillState.currentTarget}</p>
                  <p className="text-xs text-muted-foreground mt-1">{drillState.targetIndex + 1} / {drillState.targetList.length}</p>
                </div>
              )}
              {isCheckoutDrill && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{t("training.checkoutLabel")}</p>
                  <p className="text-5xl font-display text-primary">{drillState.remaining}</p>
                  {selectedDrill.id === "pressure-training" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("training.checkoutLabel")} {drillState.targetIndex + 1} / {drillState.targetList.length}
                    </p>
                  )}
                  {selectedDrill.id === "random-finish" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("training.completedOutOf10")} {drillState.hits} / 10
                    </p>
                  )}
                </div>
              )}
              {selectedDrill.id === "target-grind" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{t("game.target")}</p>
                  <p className="text-5xl font-display text-primary">
                    {(drillState.targetMul === 3 ? "T" : drillState.targetMul === 2 ? "D" : "S") + (drillState.targetBase ?? 20)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("training.hitsLabel")}: {drillState.hits} · {t("tournament.roundLabel")} {(drillState.roundsPlayed ?? 0) + 1} / {drillState.maxRounds ?? 10}
                  </p>
                </div>
              )}
              {selectedDrill.id === "big-single-lock" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("training.hitSingleRoundOf3")} {drillState.hitsThisRound}/3 {t("training.hitsOf3")}
                  </p>
                  <p className="text-5xl font-display text-primary">S{drillState.currentTarget}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("training.locked")} {drillState.lockedIndex !== undefined && drillState.lockedIndex >= 0
                      ? `S${drillState.targetList[drillState.lockedIndex]}`
                      : "—"} · {t("training.field")} {drillState.targetIndex + 1} / {drillState.targetList.length}
                    {drillState.maxRounds ? ` · ${t("tournament.roundLabel")} ${(drillState.roundsPlayed ?? 0) + 1}/${drillState.maxRounds}` : ""}
                  </p>
                </div>
              )}
              {selectedDrill.id === "random-score" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{t("training.randomTargetLabel")}</p>
                  <p className="text-5xl font-display text-primary">{drillState.randomLabel}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("tournament.roundLabel")} {(drillState.roundsPlayed ?? 0) + 1} / {drillState.maxRounds ?? 10} · {t("training.totalHitsLabel")} {drillState.hits}
                  </p>
                </div>
              )}
              {selectedDrill.id === "shanghai" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Shanghai · {t("tournament.roundLabel")} {drillState.targetIndex + 1} / 20</p>
                  <p className="text-5xl font-display text-primary">{drillState.currentTarget}</p>
                  <div className="flex justify-center gap-2 mt-2">
                    {[1, 2, 3].map((m) => (
                      <span key={m} className={`text-xs font-display px-2.5 py-1 rounded-full border transition-colors ${
                        (drillState.shanghaiMultsHit ?? []).includes(m)
                          ? "bg-secondary/20 border-secondary text-secondary"
                          : "border-border text-muted-foreground"
                      }`}>
                        {m === 1 ? "S" : m === 2 ? "D" : "T"}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{t("training.scoreLabel")} <span className="text-foreground font-bold">{drillState.shanghaiScore ?? 0}</span></p>
                </div>
              )}
              {selectedDrill.id === "shanghai-rtc" && (() => {
                const stDone = (drillState.rtcMultsHit ?? []).includes(1) && (drillState.rtcMultsHit ?? []).includes(3);
                return (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      {t("training.numberLabel")} {drillState.targetIndex + 1} / {drillState.targetList.length}
                    </p>
                    <p className={`text-5xl font-display transition-colors ${rtcFlash ? "text-destructive" : "text-primary"}`}>{drillState.currentTarget}</p>
                    <div className="flex justify-center gap-2 mt-2">
                      {[1, 3].map((m) => (
                        <span key={m} className={`text-xs font-display px-2.5 py-1 rounded-full border transition-colors ${
                          (drillState.rtcMultsHit ?? []).includes(m)
                            ? "bg-secondary/20 border-secondary text-secondary"
                            : "border-border text-muted-foreground"
                        }`}>
                          {m === 1 ? "S" : "T"}
                        </span>
                      ))}
                      <span className={`text-xs font-display px-2.5 py-1 rounded-full border transition-colors ${
                        stDone ? "bg-accent/20 border-accent text-accent animate-pulse-glow" : "border-border text-muted-foreground"
                      }`}>
                        D
                      </span>
                    </div>
                    <p className="text-xs mt-2">
                      {rtcFlash ? (
                        <span className="text-destructive font-bold animate-scale-in">{t("training.missedTryAgain")}</span>
                      ) : stDone ? (
                        <span className="text-accent font-bold">{t("training.nowDoubleToAdvance")}</span>
                      ) : (
                        <span className="text-muted-foreground">{t("training.singleTripleAnyOrder")}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("training.scoreLabel")} <span className="text-foreground font-bold">{drillState.rtcScore ?? 0}</span>
                      {drillState.maxRounds ? <> · {t("tournament.roundLabel")} {(drillState.roundsPlayed ?? 0) + 1}/{drillState.maxRounds}</> : null}
                    </p>
                  </div>
                );
              })()}
              {selectedDrill.id === "halve-it" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Halve It · {t("tournament.roundLabel")} {drillState.targetIndex + 1} / {HALVE_IT_ROUNDS.length}
                  </p>
                  <p className="text-4xl font-display text-primary">
                    {t(HALVE_IT_ROUNDS[drillState.targetIndex]?.labelKey ?? "—")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t("training.scoreStandLabel")} <span className="text-foreground font-bold">{drillState.remaining}</span>
                    {(drillState.hiRoundPoints ?? 0) > 0 && <span className="text-secondary"> (+{drillState.hiRoundPoints})</span>}
                  </p>
                </div>
              )}
              {selectedDrill.id === "bobs-27" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Bob's 27 · {t("tournament.roundLabel")} {drillState.targetIndex + 1} / {BOBS_27_ROUNDS}
                  </p>
                  <p className="text-5xl font-display text-primary">D{drillState.targetIndex + 1}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t("training.accountLabel")} <span className={`font-bold ${drillState.remaining <= 6 ? "text-destructive" : "text-foreground"}`}>{drillState.remaining}</span>
                    {" · "}{t("training.hitsThisRoundLabel")} {drillState.hitsThisRound}/3
                  </p>
                </div>
              )}
              {selectedDrill.id === "bull-control" && drillState.bcPlayers && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {t("training.scoringNumberLabel")} <span className="text-primary font-display">{drillState.bcNumber}</span> · {t("training.licenseVia")} <span className="text-accent font-display">BULL</span>
                  </p>
                  <p className="text-3xl font-display">
                    {(drillState.bcScorer ?? -1) === (drillState.bcTurn ?? 0)
                      ? <span className="text-secondary">{t("training.scoringActive")}</span>
                      : <span className="text-muted-foreground">{t("training.hitBullFirst")}</span>}
                  </p>
                  <div className="grid gap-1.5">
                    {drillState.bcPlayers.map((p, i) => (
                      <div key={p.name + i}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors ${
                          i === (drillState.bcTurn ?? 0) ? "border-primary bg-primary/10" : "border-border bg-background opacity-70"
                        }`}>
                        <span className="flex items-center gap-2 truncate">
                          {i === (drillState.bcScorer ?? -1) && <span title={t("training.scoringLicenseTitle")}>🎯</span>}
                          {p.name}
                        </span>
                        <span className="font-display text-xl">{p.remaining}</span>
                      </div>
                    ))}
                  </div>
                  {drillState.bcWinner && (
                    <p className="text-accent font-display uppercase">🏆 {drillState.bcWinner} {t("training.wins")}</p>
                  )}
                </div>
              )}

              {/* Dart counter */}
              <div className="flex justify-center gap-1 mt-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-full transition-all ${
                      i < drillState.dartsThisRound ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {t("training.dartOfThree")} {drillState.dartsThisRound + 1} / 3 · {t("training.totalShort")} {drillState.dartsThrown}
              </p>
            </div>
            </div>

            {/* Checkout suggestion for finish drills */}
            {isCheckoutDrill && drillState.remaining <= 170 && (
              <div className="mb-3">
                <CheckoutSuggestion remaining={drillState.remaining} playerName={t("training.trainingPlayerName")} />
              </div>
            )}

            {/* Live Camera (auto-scoring) */}
            {cameraEnabled && (
              <LiveCamera
                enabled={cameraEnabled}
                onClose={() => setCameraEnabled(false)}
                onRoundCommit={handleCameraRound}
                dartsRemaining={Math.max(1, 3 - drillState.dartsThisRound)}
                playerName={t("training.trainingPlayerName")}
              />
            )}

            {/* Score input — quick-round/typed-total/voice only for the 3 checkout-style drills,
                since those are the only ones where a visit TOTAL (rather than a specific segment)
                is enough to know what happened. */}
            <DartScoreInput
              isDisabled={drillState.finished}
              onThrow={handleDrillThrow}
              onQuickRound={isCheckoutDrill ? handleQuickRound : undefined}
              dartsThisRound={drillState.dartsThisRound}
            />

            {/* Undo + Camera toggle */}
            <div className="flex gap-2 mt-3">
              <Button variant="outline" onClick={undoLastDart} disabled={undoStack.length === 0} className="flex-1 gap-1">
                <Undo2 className="w-4 h-4" /> {t("training.undo")}
              </Button>
              <Button
                variant={cameraEnabled ? "default" : "outline"}
                onClick={() => {
                  if (!cameraEnabled && !clubHasFeature(club?.plan_tier, "camera")) {
                    toast({ title: t("plan.cameraGatedTitle"), description: t("plan.cameraGatedDesc") });
                    return;
                  }
                  setCameraEnabled((v) => !v);
                }}
                className="flex-1 gap-2"
              >
                <Camera className="w-4 h-4" /> {cameraEnabled ? t("training.cameraOff") : t("training.cameraScoring")}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ─── DRILL SELECTION (pre-start) ──────────────────
  if (selectedDrill && !drillState) {
    const supportsRoundLimit = ["around-the-clock", "doubles-only", "big-single-lock", "target-grind", "shanghai-rtc"].includes(selectedDrill.id);
    const isTargetGrind = selectedDrill.id === "target-grind";
    const isBullControl = selectedDrill.id === "bull-control";
    const isShanghaiRtc = selectedDrill.id === "shanghai-rtc";
    const bcNames = drillConfig.bcPlayerNames ?? [`${t("stats.player")} 1`, `${t("stats.player")} 2`];
    return (
      <div className="container py-6 animate-slide-up max-w-lg mx-auto">
        <Button variant="ghost" onClick={() => { setSelectedDrill(null); setDrillConfig({}); }} className="mb-4 text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-1" /> {t("common.back")}
        </Button>

        <div className="bg-card rounded-xl border border-border p-6 text-center">
          <selectedDrill.icon className="w-12 h-12 text-primary mx-auto mb-3" />
          <h2 className="text-2xl font-display uppercase mb-2">{selectedDrill.name}</h2>
          <p className="text-muted-foreground text-sm mb-4">{t(selectedDrill.descriptionKey)}</p>

          <div className="flex justify-center gap-3 mb-6">
            <span className={`text-xs px-2 py-1 rounded-full ${DIFFICULTY_COLORS[selectedDrill.difficulty]}`}>
              {t(DIFFICULTY_LABEL_KEY[selectedDrill.difficulty])}
            </span>
            <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
              ~{selectedDrill.durationMinutes} {t("training.minutesSuffix")}
            </span>
          </div>

          {currentRecord && (
            <div className="mb-5">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-accent" /> {t("training.yourRecordLabel")} <span className="text-foreground font-semibold">{currentRecord.value}</span> · {currentRecord.label}
              </p>
              {/* Trend, not just the single best — the record alone can't show whether recent
                  attempts are actually improving. Inverted for "fewer is better" drills (darts-to-
                  finish etc.) so the line trending up always reads as "getting better", regardless
                  of which direction the underlying number itself improves in. */}
              {history.length > 1 && (
                <div className="mt-3 px-2">
                  <Sparkline values={history.map((h) => (currentRecord.higherIsBetter ? h.value : -h.value))} height={32} />
                  <p className="text-[10px] text-muted-foreground mt-1 text-center">{t("training.recentAttemptsLabel")} ({history.length})</p>
                </div>
              )}
            </div>
          )}

          {isBullControl && (
            <div className="mb-5 text-left space-y-4 bg-muted/30 rounded-lg p-4">
              <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
                <Settings2 className="w-3.5 h-3.5" /> {t("training.settingsHeading")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{t("training.startingPoints")}</p>
                  <select className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm"
                    value={drillConfig.bcStart ?? 301}
                    onChange={(e) => setDrillConfig((c) => ({ ...c, bcStart: Number(e.target.value) }))}>
                    {[101, 201, 301, 501].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{t("training.scoringNumber")}</p>
                  <select className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm"
                    value={drillConfig.bcNumber ?? 20}
                    onChange={(e) => setDrillConfig((c) => ({ ...c, bcNumber: Number(e.target.value) }))}>
                    {[20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t("stats.player")} ({bcNames.length})</p>
                {bcNames.map((n, i) => (
                  <input key={i} value={n}
                    onChange={(e) => setDrillConfig((c) => ({
                      ...c,
                      bcPlayerNames: (c.bcPlayerNames ?? bcNames).map((v, idx) => idx === i ? e.target.value : v),
                    }))}
                    className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm" />
                ))}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={bcNames.length >= BULL_CONTROL_MAX_PLAYERS}
                    onClick={() => setDrillConfig((c) => ({ ...c, bcPlayerNames: [...bcNames, `${t("stats.player")} ${bcNames.length + 1}`] }))}>
                    {t("training.addPlayerShort")}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={bcNames.length <= 2}
                    onClick={() => setDrillConfig((c) => ({ ...c, bcPlayerNames: bcNames.slice(0, -1) }))}>
                    {t("training.removePlayerShort")}
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("training.bullControlRules")}
              </p>
            </div>
          )}

          {(supportsRoundLimit || isTargetGrind) && (
            <div className="mb-5 text-left space-y-4 bg-muted/30 rounded-lg p-4">
              <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
                <Settings2 className="w-3.5 h-3.5" /> {t("training.settingsHeading")}
              </div>

              {isShanghaiRtc && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t("training.startingNumber")}</p>
                  <select
                    className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm"
                    value={drillConfig.rtcStart ?? 1}
                    onChange={(e) => setDrillConfig((c) => ({ ...c, rtcStart: Number(e.target.value) }))}
                  >
                    {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              )}

              {isTargetGrind && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t("training.chooseTargetField")}</p>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 bg-background border border-border rounded-md px-2 py-1.5 text-sm"
                      value={drillConfig.targetMul ?? 3}
                      onChange={(e) => {
                        const mul = Number(e.target.value);
                        // There's no triple-bull ring — nothing in the app can ever register that
                        // hit (DartScoreInput's bull buttons only emit multiplier 1/2, and
                        // LiveCamera explicitly folds 25×3 back to 25×1), so a "Triple Bull"
                        // session used to run at a guaranteed, unwarned 0% hit rate.
                        setDrillConfig((c) => ({ ...c, targetMul: mul, targetBase: mul === 3 && c.targetBase === 25 ? 20 : c.targetBase }));
                      }}
                    >
                      <option value={1}>{t("training.singleOption")}</option>
                      <option value={2}>{t("training.doubleOption")}</option>
                      <option value={3}>{t("training.tripleOption")}</option>
                    </select>
                    <select
                      className="flex-1 bg-background border border-border rounded-md px-2 py-1.5 text-sm"
                      value={drillConfig.targetBase ?? 20}
                      onChange={(e) => setDrillConfig((c) => ({ ...c, targetBase: Number(e.target.value) }))}
                    >
                      {[20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 25]
                        .filter((n) => n !== 25 || (drillConfig.targetMul ?? 3) !== 3)
                        .map((n) => (
                          <option key={n} value={n}>{n === 25 ? t("game.bull") : n}</option>
                        ))}
                    </select>
                  </div>
                </div>
              )}

              {supportsRoundLimit && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {t("training.roundsLabel")} {isTargetGrind ? "" : t("training.optionalUnlimitedNote")}
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {[5, 10, 15, 20, 30].map((n) => (
                      <button
                        key={n}
                        onClick={() => setDrillConfig((c) => ({ ...c, maxRounds: n }))}
                        className={`px-3 py-1 rounded-md text-xs border transition-colors ${
                          drillConfig.maxRounds === n
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:border-primary/40"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    {!isTargetGrind && (
                      <button
                        onClick={() => setDrillConfig((c) => ({ ...c, maxRounds: undefined }))}
                        className={`px-3 py-1 rounded-md text-xs border transition-colors ${
                          !drillConfig.maxRounds
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:border-primary/40"
                        }`}
                      >
                        {t("training.endless")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <Button onClick={() => startDrill(selectedDrill)} className="w-full font-display uppercase text-lg py-6">
            <Play className="w-5 h-5 mr-2" /> {t("training.startTraining")}
          </Button>
        </div>
      </div>
    );
  }

  // ─── DRILL LIST VIEW ──────────────────────────────
  return (
    <div className="container py-6 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <Dumbbell className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-display uppercase">{t("training.pageTitle")}</h2>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setFilterCategory(cat.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              filterCategory === cat.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filteredDrills.map((drill) => (
          <button
            key={drill.id}
            onClick={() => setSelectedDrill(drill)}
            className="bg-card border border-border rounded-xl p-4 text-left hover:border-primary/40 transition-all group"
          >
            <div className="flex items-start gap-3">
              <drill.icon className="w-8 h-8 text-primary shrink-0 group-hover:scale-110 transition-transform" />
              <div className="min-w-0">
                <p className="font-semibold text-sm mb-1">{drill.name}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{t(drill.descriptionKey)}</p>
                <div className="flex gap-2 mt-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${DIFFICULTY_COLORS[drill.difficulty]}`}>
                    {t(DIFFICULTY_LABEL_KEY[drill.difficulty])}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {drill.durationMinutes} {t("training.minutesSuffix")}
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-6">
        <CoachingPlan
          onStartDrill={(drillId) => {
            const drill = TRAINING_DRILLS.find((d) => d.id === drillId);
            if (drill) {
              setSelectedDrill(drill);
              startDrill(drill);
            }
          }}
        />
      </div>
    </div>
  );
};

export default TrainingPage;
