/**
 * Merging two copies of the same training key (this device's and the account's). Pure functions, so they can be
 * tested and so the merge gives the same answer whichever copy is read first.
 */

interface RecordValue { value: number; higherIsBetter: boolean; label?: string; achievedAt?: string }
interface HistoryValue { value: number; achievedAt: string }
interface StreakValue { current: number; best: number; lastDate: string }

export const HISTORY_LIMIT = 15;

const isRecord = (v: unknown): v is RecordValue => !!v && typeof v === "object" && typeof (v as RecordValue).value === "number";
const isHistory = (v: unknown): v is HistoryValue[] => Array.isArray(v);
const isStreak = (v: unknown): v is StreakValue => !!v && typeof v === "object" && typeof (v as StreakValue).lastDate === "string";

/** The better personal best of the two. */
function mergeRecord(a: RecordValue, b: RecordValue): RecordValue {
  const higher = a.higherIsBetter ?? b.higherIsBetter ?? true;
  if (a.value === b.value) return (a.achievedAt ?? "") <= (b.achievedAt ?? "") ? a : b; // the earlier one set it
  return (higher ? a.value > b.value : a.value < b.value) ? a : b;
}

/** Both attempt lists in time order, each attempt once, the newest HISTORY_LIMIT kept. */
function mergeHistory(a: HistoryValue[], b: HistoryValue[]): HistoryValue[] {
  const seen = new Set<string>();
  return [...a, ...b]
    .filter((e) => e && typeof e.value === "number" && typeof e.achievedAt === "string")
    .filter((e) => {
      const id = `${e.achievedAt}|${e.value}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((x, y) => x.achievedAt.localeCompare(y.achievedAt))
    .slice(-HISTORY_LIMIT);
}

/** The streak that was practised last, and the longest one ever seen on either side. */
function mergeStreak(a: StreakValue, b: StreakValue): StreakValue {
  const latest = a.lastDate >= b.lastDate ? a : b;
  return { ...latest, best: Math.max(a.best ?? 0, b.best ?? 0, latest.current ?? 0) };
}

/** Merges one key's two values; either side may be missing. */
export function mergeTrainingValue(key: string, local: unknown, remote: unknown): unknown {
  if (local === undefined || local === null) return remote;
  if (remote === undefined || remote === null) return local;
  if (key.startsWith("training-record-") && isRecord(local) && isRecord(remote)) return mergeRecord(local, remote);
  if (key.startsWith("training-history-") && isHistory(local) && isHistory(remote)) return mergeHistory(local, remote);
  if (key === "training-streak" && isStreak(local) && isStreak(remote)) return mergeStreak(local, remote);
  return local;
}

/** True when the training key belongs in the account (records, history, streak). */
export const isTrainingKey = (key: string): boolean =>
  key.startsWith("training-record-") || key.startsWith("training-history-") || key === "training-streak";
