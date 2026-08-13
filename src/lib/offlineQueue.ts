import type { GameState } from "@/types/game";

/**
 * Offline write queue for finished game results.
 *
 * The PWA app shell loads instantly even offline, and scoring itself is already
 * fully local (nothing is written to Supabase per-throw) — the one real network
 * dependency is the final save when a match finishes. This queue makes that save
 * durable: if it fails (no connection / flaky venue wifi), the finished game is
 * persisted to IndexedDB instead of lost, and gets replayed automatically once
 * the browser is back online.
 */

const DB_NAME = "darts-offline-queue";
const DB_VERSION = 1;
const STORE = "pending_game_saves";

export interface QueuedGameSave {
  /** Same id used as the `games.id` primary key, so replays are idempotent. */
  id: string;
  game: GameState;
  userId: string | undefined;
  /** Set when the game was started from a tournament bracket match, so the replay can still tag the saved row. */
  tournamentLink?: { tournamentId: string; matchId: string };
  createdAt: number;
  attempts: number;
  lastError?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function enqueueGameSave(item: Omit<QueuedGameSave, "createdAt" | "attempts">): Promise<void> {
  await withStore("readwrite", (store) =>
    store.put({ ...item, createdAt: Date.now(), attempts: 0 } satisfies QueuedGameSave)
  );
  notifyListeners();
}

export async function listQueuedGameSaves(): Promise<QueuedGameSave[]> {
  try {
    return await withStore<QueuedGameSave[]>("readonly", (store) => store.getAll());
  } catch {
    return [];
  }
}

async function removeQueuedGameSave(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
  notifyListeners();
}

async function bumpAttempt(item: QueuedGameSave, error: unknown): Promise<void> {
  await withStore("readwrite", (store) =>
    store.put({ ...item, attempts: item.attempts + 1, lastError: String(error) } satisfies QueuedGameSave)
  );
  notifyListeners();
}

export async function getQueueCount(): Promise<number> {
  try {
    const all = await listQueuedGameSaves();
    return all.length;
  } catch {
    return 0;
  }
}

type Listener = (count: number) => void;
const listeners = new Set<Listener>();

export function subscribeQueueCount(listener: Listener): () => void {
  listeners.add(listener);
  getQueueCount().then(listener);
  return () => listeners.delete(listener);
}

function notifyListeners() {
  getQueueCount().then((count) => listeners.forEach((l) => l(count)));
}

let flushInFlight: Promise<{ synced: number; failed: number }> | null = null;

/**
 * Replays every queued game save against Supabase. Safe to call opportunistically
 * (app start, `online` event, manual retry button) — concurrent calls share one run.
 */
export async function flushGameSaveQueue(
  replay: (game: GameState, userId: string | undefined, pendingGameId: string, tournamentLink?: { tournamentId: string; matchId: string }) => Promise<void>
): Promise<{ synced: number; failed: number }> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    let synced = 0;
    let failed = 0;
    const items = await listQueuedGameSaves();
    for (const item of items) {
      try {
        await replay(item.game, item.userId, item.id, item.tournamentLink);
        await removeQueuedGameSave(item.id);
        synced++;
      } catch (err) {
        await bumpAttempt(item, err);
        failed++;
      }
    }
    return { synced, failed };
  })();
  try {
    return await flushInFlight;
  } finally {
    flushInFlight = null;
  }
}
