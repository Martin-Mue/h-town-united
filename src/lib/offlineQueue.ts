import type { GameState } from "@/types/game";

/**
 * Offline write queues for anything that must reach Supabase after a match, but can't be
 * dropped just because the club's wifi hiccups: finished game results, and (separately)
 * tournament bracket write-backs for a "Spiel starten" live game. Two independent IndexedDB
 * object stores, same durable enqueue → flush-on-reconnect shape.
 */

const DB_NAME = "darts-offline-queue";
const DB_VERSION = 2;
const GAME_STORE = "pending_game_saves";
const MATCH_RESULT_STORE = "pending_match_results";

export interface QueuedGameSave {
  /** Same id used as the `games.id` primary key, so replays are idempotent. */
  id: string;
  game: GameState;
  userId: string | undefined;
  /** The club the game was played in AT THE TIME it was queued — captured here rather than
   *  re-resolved at replay time, so a device that's offline for a while still tags the game
   *  correctly even if (in a future multi-club world) whatever the app resolves as "current
   *  club" could theoretically have changed by the time connectivity comes back. */
  clubId: string | null;
  /** Set when the game was started from a tournament bracket match, so the replay can still tag the saved row. */
  tournamentLink?: { tournamentId: string; matchId: string };
  /** Set when the game was a synced two-device online match, so the replay still tags the saved row correctly. */
  playedOnline?: boolean;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface QueuedMatchResult {
  id: string;
  tournamentId: string;
  matchId: string;
  winnerName: string;
  score1?: number;
  score2?: number;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(GAME_STORE)) db.createObjectStore(GAME_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(MATCH_RESULT_STORE)) db.createObjectStore(MATCH_RESULT_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/** One IndexedDB-backed queue: enqueue, list, a live pending-count subscription, and a
 *  flush-with-retry runner. Shared by the game-save queue and the match-result queue below
 *  so neither has to reimplement the same store/transaction/attempt-tracking boilerplate. */
function createQueue<T extends { id: string; createdAt: number; attempts: number; lastError?: string }>(storeName: string) {
  const listeners = new Set<(count: number) => void>();

  const list = async (): Promise<T[]> => {
    try {
      const items = await withStore<T[]>(storeName, "readonly", (store) => store.getAll());
      // getAll() returns IndexedDB key order (this store's key is `id`, a random UUID) — not
      // insertion order. Replaying game-saves out of chronological order silently corrupts Elo
      // (deltas are computed from each player's *current* rating, re-read at replay time, so the
      // result is order-dependent) even though every individual replay itself succeeds cleanly.
      return items.sort((a, b) => a.createdAt - b.createdAt);
    } catch {
      return [];
    }
  };

  const count = async (): Promise<number> => (await list()).length;

  const notify = () => {
    count().then((c) => listeners.forEach((l) => l(c)));
  };

  const remove = async (id: string): Promise<void> => {
    await withStore(storeName, "readwrite", (store) => store.delete(id));
    notify();
  };

  const bumpAttempt = async (item: T, error: unknown): Promise<void> => {
    await withStore(storeName, "readwrite", (store) => store.put({ ...item, attempts: item.attempts + 1, lastError: String(error) }));
    notify();
  };

  let flushInFlight: Promise<{ synced: number; failed: number }> | null = null;

  return {
    enqueue: async (item: Omit<T, "createdAt" | "attempts">): Promise<void> => {
      await withStore(storeName, "readwrite", (store) => store.put({ ...item, createdAt: Date.now(), attempts: 0 } as unknown as T));
      notify();
    },
    list,
    count,
    subscribeCount: (listener: (count: number) => void): (() => void) => {
      listeners.add(listener);
      count().then(listener);
      return () => listeners.delete(listener);
    },
    /** Replays every queued item. Safe to call opportunistically (app start, `online` event) — concurrent calls share one run. */
    flush: async (replay: (item: T) => Promise<void>): Promise<{ synced: number; failed: number }> => {
      if (flushInFlight) return flushInFlight;
      flushInFlight = (async () => {
        let synced = 0;
        let failed = 0;
        for (const item of await list()) {
          try {
            await replay(item);
            await remove(item.id);
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
    },
  };
}

const gameQueue = createQueue<QueuedGameSave>(GAME_STORE);

export const enqueueGameSave = gameQueue.enqueue;
export const listQueuedGameSaves = gameQueue.list;
export const subscribeQueueCount = gameQueue.subscribeCount;
export const getQueueCount = gameQueue.count;

export async function flushGameSaveQueue(
  replay: (game: GameState, userId: string | undefined, clubId: string | null, pendingGameId: string, tournamentLink?: { tournamentId: string; matchId: string }, playedOnline?: boolean) => Promise<void>
): Promise<{ synced: number; failed: number }> {
  return gameQueue.flush((item) => replay(item.game, item.userId, item.clubId ?? null, item.id, item.tournamentLink, item.playedOnline));
}

const matchResultQueue = createQueue<QueuedMatchResult>(MATCH_RESULT_STORE);

export const enqueueMatchResult = matchResultQueue.enqueue;
export const listQueuedMatchResults = matchResultQueue.list;
export const subscribeMatchResultQueueCount = matchResultQueue.subscribeCount;

export async function flushMatchResultQueue(
  replay: (tournamentId: string, matchId: string, result: { winnerName: string; score1?: number; score2?: number }) => Promise<void>
): Promise<{ synced: number; failed: number }> {
  return matchResultQueue.flush((item) => replay(item.tournamentId, item.matchId, { winnerName: item.winnerName, score1: item.score1, score2: item.score2 }));
}
