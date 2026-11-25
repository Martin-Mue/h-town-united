import { supabase } from "@/integrations/supabase/client";
import { isTrainingKey, mergeTrainingValue } from "./trainingProgressMerge";

/**
 * Where training records, attempt history and the practice streak are kept.
 *
 * Reads and writes stay synchronous on this device's storage (the training screen reads them on every render), but
 * per signed-in account (keys are prefixed with the user id, so two members sharing a phone no longer share records),
 * and every write is mirrored to the account (table training_progress). On sign-in syncTrainingProgress merges both.
 */

let scopeUserId: string | null = null;

/** Points reads and writes at the signed-in account. Synchronous and cheap, so it can run while rendering: a training
 *  screen that mounts in the same render as the sign-in must already read the account's records. */
export function setTrainingScope(userId: string | null): void {
  scopeUserId = userId;
}

const scoped = (key: string) => (scopeUserId ? `u:${scopeUserId}:${key}` : key);
const scopePrefix = () => (scopeUserId ? `u:${scopeUserId}:` : "");

/** Every stored training key of the signed-in account (or of the device, signed out), without the scope prefix. */
export function trainingKeys(prefix: string): string[] {
  if (typeof window === "undefined") return [];
  const out: string[] = [];
  const scopeStart = scopePrefix();
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(scopeStart)) continue;
      const plain = key.slice(scopeStart.length);
      if (!scopeStart && plain.startsWith("u:")) continue; // another account's copy
      if (plain.startsWith(prefix)) out.push(plain);
    }
  } catch {
    // storage blocked: nothing stored
  }
  return out;
}

export function readTraining<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(scoped(key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeTraining(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(scoped(key), JSON.stringify(value));
  } catch {
    // storage full or blocked: the account copy below still keeps it
  }
  const userId = scopeUserId;
  if (!userId || !isTrainingKey(key)) return;
  void supabase
    .from("training_progress" as never)
    .upsert({ user_id: userId, key, value, updated_at: new Date().toISOString() } as never, { onConflict: "user_id,key" })
    .then(({ error }) => {
      if (error) console.warn("training progress not saved to the account", error.message);
    });
}

const LEGACY_CLAIMED_KEY = "training-legacy-claimed-by";

/**
 * Switches storage to the signed-in account (null = signed out) and merges this device's copy with the account's.
 * The first account to sign in on a device also takes over the records kept there before they were per account.
 * Safe to call repeatedly; never throws.
 */
export async function syncTrainingProgress(userId: string | null): Promise<void> {
  setTrainingScope(userId);
  if (!userId || typeof window === "undefined") return;
  try {
    // 1. Records from before they were per account (unprefixed keys) go to the first account signing in here.
    if (!window.localStorage.getItem(LEGACY_CLAIMED_KEY)) {
      window.localStorage.setItem(LEGACY_CLAIMED_KEY, userId);
      const legacy: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && isTrainingKey(key)) legacy.push(key);
      }
      for (const key of legacy) {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        try {
          const merged = mergeTrainingValue(key, readTraining(key), JSON.parse(raw));
          window.localStorage.setItem(scoped(key), JSON.stringify(merged));
        } catch {
          // unreadable old entry: skip it
        }
        window.localStorage.removeItem(key);
      }
    }

    // 2. Merge with the account: every key either side has.
    const { data, error } = await supabase.from("training_progress" as never).select("key, value").eq("user_id", userId);
    if (error || scopeUserId !== userId) return;
    const remote = new Map((data as unknown as { key: string; value: unknown }[] ?? []).map((row) => [row.key, row.value]));
    const localKeys = trainingKeys("training-");
    const allKeys = new Set([...localKeys, ...remote.keys()]);
    const changedForAccount: { user_id: string; key: string; value: unknown; updated_at: string }[] = [];
    for (const key of allKeys) {
      if (!isTrainingKey(key)) continue;
      const local = readTraining(key);
      const merged = mergeTrainingValue(key, local, remote.get(key));
      if (JSON.stringify(merged) !== JSON.stringify(local)) window.localStorage.setItem(scoped(key), JSON.stringify(merged));
      if (JSON.stringify(merged) !== JSON.stringify(remote.get(key))) {
        changedForAccount.push({ user_id: userId, key, value: merged, updated_at: new Date().toISOString() });
      }
    }
    if (changedForAccount.length > 0) {
      await supabase.from("training_progress" as never).upsert(changedForAccount as never, { onConflict: "user_id,key" });
    }
  } catch (err) {
    console.warn("training progress sync failed", err);
  }
}
