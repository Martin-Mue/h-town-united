/** Training drill catalog + device-local personal-records/streak storage — pulled OUT of
 *  Training.tsx (2026-09-10) specifically so Statistics.tsx's personal-scope "Mein Training" tab
 *  can read this data WITHOUT importing the Training page component itself. Training.tsx eagerly
 *  imports LiveCamera, DartScoreInput, CoachingPlan, CheckoutSuggestion and the ONNX-backed
 *  dartModel utilities (unlike Game.tsx, which lazy-loads LiveCamera) — importing any named
 *  export from "@/pages/Training" therefore drags that entire camera/ML dependency tree into
 *  whichever OTHER page imports it too, which is exactly what broke the Statistics page after the
 *  Training tab was first added there (reported 2026-09-10, "Etwas ist schiefgelaufen"). This file
 *  has no such baggage — plain data plus localStorage reads/writes, safe to import from anywhere.
 *  Training.tsx now imports everything below from here instead of defining it locally, so there is
 *  exactly one source of truth either way. */
import { Target, RotateCw, Crosshair, Zap, Trophy, Lock, Shuffle, PartyPopper, Divide, ListOrdered, Route, Heart, Medal, Gauge, PiggyBank } from "lucide-react";

/** Training drill definition */
export interface TrainingDrill {
  id: string;
  name: string;
  descriptionKey: string;
  icon: typeof Target;
  difficulty: "beginner" | "intermediate" | "pro";
  durationMinutes: number;
  category: "doubles" | "finishing" | "accuracy" | "pressure";
}

/** Available training drills — single source of truth for both Training.tsx (plays them) and
 *  Statistics.tsx's personal-scope "Mein Training" tab (shows a record per drill, see
 *  loadAllRecords below).
 *
 *  Ordered functionally/thematically (2026-09-10, on request): grouped by `category` in the same
 *  sequence the in-app category filter already uses (doubles → finishing → accuracy → pressure —
 *  see Training.tsx's own `categories` list), alphabetically by name within each group. Purely a
 *  presentation-order change — every id/field is unchanged, so this touches nothing but the order
 *  drills appear in the "all" view and within each filtered tab. */
export const TRAINING_DRILLS: TrainingDrill[] = [
  // ── doubles ──
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
    id: "doubles-only",
    name: "Doubles Only",
    descriptionKey: "training.doublesOnlyDesc",
    icon: Target,
    difficulty: "beginner",
    durationMinutes: 15,
    category: "doubles",
  },
  // ── finishing ──
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
    // 2026-09-10, on request ("gern auch über ein neues finish training nachdenken"): a themed
    // checkout ladder (40 → 170) instead of one fixed or fully random target — see the drill's own
    // in-app tier badges (Bronze/Silver/Gold) for the "legendary" framing. Reuses the exact same
    // sequential-ladder mechanic as pressure-training (see Training.tsx's own case for why), just
    // with a curated, ascending-difficulty checkout list instead of PRESSURE_CHECKOUTS.
    id: "legendary-finishes",
    name: "Legendary Finishes",
    descriptionKey: "training.legendaryFinishesDesc",
    icon: Medal,
    difficulty: "pro",
    durationMinutes: 15,
    category: "finishing",
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
  // ── accuracy ──
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
    id: "big-single-lock",
    name: "Big Single Lock",
    descriptionKey: "training.bigSingleLockDesc",
    icon: Lock,
    difficulty: "intermediate",
    durationMinutes: 15,
    category: "accuracy",
  },
  {
    // 2026-09-10, on request ("Ghost-Rennen"): plays exactly like Around the Clock (same
    // targetList/currentTarget mechanic in Training.tsx's startDrill/processDart — literally the
    // same switch case) but the live view additionally shows whether the current run is ahead of
    // or behind the pace of the player's own personal-best run for this drill, computed live from
    // currentRecord — no extra stored state needed, see Training.tsx's ghost-pace block.
    id: "ghost-race",
    name: "Ghost Race",
    descriptionKey: "training.ghostRaceDesc",
    icon: Gauge,
    difficulty: "intermediate",
    durationMinutes: 10,
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
    id: "target-grind",
    name: "Target Grind",
    descriptionKey: "training.targetGrindDesc",
    icon: Target,
    difficulty: "intermediate",
    durationMinutes: 20,
    category: "accuracy",
  },
  // ── pressure ──
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
    // 2026-09-10, on request ("Combo-Risiko"): push-your-luck — pick a field, each consecutive hit
    // raises a streak multiplier on top of an accumulating "pending" score, but a single miss wipes
    // out whatever hasn't been voluntarily banked yet (see Training.tsx's bankPoints handler). The
    // record is total banked points, not the highest streak — banking too late loses everything.
    id: "combo-risk",
    name: "Combo Risk",
    descriptionKey: "training.comboRiskDesc",
    icon: PiggyBank,
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
    id: "pressure-training",
    name: "Pressure Training",
    descriptionKey: "training.pressureTrainingDesc",
    icon: Zap,
    difficulty: "pro",
    durationMinutes: 20,
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
    id: "shanghai-rtc",
    name: "Shanghai Round the Clock",
    descriptionKey: "training.shanghaiRtcDesc",
    icon: Route,
    difficulty: "pro",
    durationMinutes: 20,
    category: "pressure",
  },
  {
    id: "sudden-death",
    name: "Sudden Death",
    descriptionKey: "training.suddenDeathDesc",
    icon: Heart,
    difficulty: "intermediate",
    durationMinutes: 10,
    category: "pressure",
  },
];

export const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-secondary/20 text-secondary",
  intermediate: "bg-primary/20 text-primary",
  pro: "bg-accent/20 text-accent",
};

export const DIFFICULTY_LABEL_KEY: Record<string, string> = {
  beginner: "training.difficultyBeginner",
  intermediate: "training.difficultyIntermediate",
  pro: "training.difficultyPro",
};

// ─── personal records ──────────────────────────────────────────────
// Device-local (not synced to an account — training drills are practice reps, not recorded
// games) best result per drill, so recurring practice has something to actually chase. Only
// drills with a genuinely comparable single-number outcome get one (see Training.tsx's own
// computeRecordCandidate); bull-control is inherently multiplayer/competitive and has no "your"
// record to speak of.
export interface RecordEntry {
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
export function recordVariant(drillId: string, ctx: { maxRounds?: number; rtcStart?: number; targetBase?: number; targetMul?: number; lives?: number }): string | undefined {
  // Round count alone used to be the whole key — a trivial-target run (e.g. Single-1) hitting
  // 93% at 10 rounds would overwrite a genuinely hard T20 record at the same round count, since
  // both hashed to the same variant. Which target was actually practiced matters at least as much
  // as how many rounds, so it's part of the key too now.
  if (drillId === "target-grind") return `${ctx.targetMul ?? 3}x${ctx.targetBase ?? 20}:${ctx.maxRounds ?? 10}`;
  // Shanghai RTC's difficulty depends on BOTH where it starts (fewer numbers left from 20) and
  // whether a round cap is set — a 5-round-capped run starting at 19 (just 2 numbers) isn't a
  // fair comparison against an uncapped full run from 1, so both go into the variant key.
  if (drillId === "shanghai-rtc") return `${ctx.rtcStart ?? 1}-${ctx.maxRounds ?? "open"}`;
  // Sudden Death: both which field is being hunted AND how many lives you started with change the
  // difficulty enormously (T20 on 1 life is a wholly different challenge from S1 on 10 lives) —
  // same reasoning as Target Grind above, just with lives instead of a round cap.
  if (drillId === "sudden-death") return `${ctx.targetMul ?? 3}x${ctx.targetBase ?? 20}:${ctx.lives ?? 3}`;
  // Combo Risk: which field was chosen changes both how often it hits (streak length) and how
  // much each hit is worth — same reasoning as Target Grind/Sudden Death above.
  if (drillId === "combo-risk") return `${ctx.targetMul ?? 3}x${ctx.targetBase ?? 20}`;
  return undefined;
}

const RECORD_KEY_PREFIX = "training-record-";
const recordKey = (drillId: string, variant?: string) => `${RECORD_KEY_PREFIX}${drillId}${variant ? `:${variant}` : ""}`;

export function loadRecord(drillId: string, variant?: string): RecordEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(recordKey(drillId, variant));
    return raw ? (JSON.parse(raw) as RecordEntry) : null;
  } catch {
    return null;
  }
}

export function saveRecord(drillId: string, entry: RecordEntry, variant?: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(recordKey(drillId, variant), JSON.stringify(entry));
}

/** One drill's stored personal best, plus which drill/variant it belongs to — `recordKey` above
 *  bakes both into one opaque localStorage key, so reading them back out needs the reverse. */
export interface StoredRecordEntry extends RecordEntry {
  drillId: string;
  variant?: string;
}

/** Scans every `training-record-*` entry in localStorage — the only way to enumerate which drills
 *  (and, for a drill like Target Grind or Sudden Death whose difficulty is player-configurable,
 *  which specific variants) actually have a saved result, since nothing else tracks that list.
 *  Used by the "Meine Rekorde"-style overview in Statistics.tsx's personal-scope Training tab. */
export function loadAllRecords(): StoredRecordEntry[] {
  if (typeof window === "undefined") return [];
  const out: StoredRecordEntry[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(RECORD_KEY_PREFIX)) continue;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const entry = JSON.parse(raw) as RecordEntry;
      const rest = key.slice(RECORD_KEY_PREFIX.length);
      // A variant string can itself contain ":" (e.g. Target Grind's "3x20:10"), so only the
      // FIRST colon separates drillId from variant — a plain split(":") would wrongly chop a
      // variant like that into extra pieces.
      const sep = rest.indexOf(":");
      const drillId = sep === -1 ? rest : rest.slice(0, sep);
      const variant = sep === -1 ? undefined : rest.slice(sep + 1);
      out.push({ ...entry, drillId, variant });
    } catch {
      // Malformed entry (shouldn't happen — only this file ever writes these keys) — skip it
      // rather than let one bad row break the whole overview.
    }
  }
  return out;
}

// ─── attempt history (trend) ──────────────────────────────────────
// Same device-local storage as the record above (see its own comment for why) — this just adds
// what the record alone can't show: whether you're actually trending better lately, not only
// "is this the best you've ever done." Every fair/comparable completed run counts, not just the
// ones that broke the record — same gate Training.tsx's computeRecordCandidate uses.
export interface HistoryEntry {
  value: number;
  achievedAt: string;
}

const HISTORY_LIMIT = 15;
const historyKey = (drillId: string, variant?: string) => `training-history-${drillId}${variant ? `:${variant}` : ""}`;

export function loadHistory(drillId: string, variant?: string): HistoryEntry[] {
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
export function pushHistoryEntry(drillId: string, entry: HistoryEntry, variant?: string): HistoryEntry[] {
  const next = [...loadHistory(drillId, variant), entry].slice(-HISTORY_LIMIT);
  if (typeof window !== "undefined") window.localStorage.setItem(historyKey(drillId, variant), JSON.stringify(next));
  return next;
}

// ─── practice streak (2026-09-09) ──────────────────────────────────
// Same device-local storage as the record/history above (see their own comments for why —
// there's no server-side "training session" table at all, only per-drill local history) — one
// shared key across every drill, since the streak is "did you practice today", not "did you
// practice THIS drill today". A local calendar-date string (not a timestamp) is the unit that
// matters here — two runs an hour apart on the same day must count as one day, and this is
// simplest done by comparing "YYYY-MM-DD" strings directly rather than diffing timestamps.
export interface StreakState { current: number; best: number; lastDate: string }
const STREAK_KEY = "training-streak";
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function loadStreak(): StreakState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STREAK_KEY);
    return raw ? (JSON.parse(raw) as StreakState) : null;
  } catch {
    return null;
  }
}
/** Call once per genuinely completed drill run (same gate as pushHistoryEntry — see its call
 *  site). A second completed run later the SAME day is a no-op (already counted); a gap of
 *  exactly one calendar day extends the streak; any bigger gap (or no prior streak at all)
 *  restarts it at 1. Returns the updated state so the caller can set it straight into render
 *  state without a redundant loadStreak() right after. */
export function recordPracticeDay(): StreakState {
  const today = todayLocal();
  const prev = loadStreak();
  let next: StreakState;
  if (prev?.lastDate === today) {
    next = prev;
  } else {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    const current = prev?.lastDate === yStr ? prev.current + 1 : 1;
    next = { current, best: Math.max(current, prev?.best ?? 0), lastDate: today };
  }
  if (typeof window !== "undefined") window.localStorage.setItem(STREAK_KEY, JSON.stringify(next));
  return next;
}
