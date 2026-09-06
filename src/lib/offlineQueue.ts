import type { GameState } from "@/types/game";
import type { BracketActionPayload } from "@/utils/tournament";

/**
 * Offline write queues for anything that must reach Supabase after a match, but can't be
 * dropped just because the club's wifi hiccups: finished game results, tournament bracket
 * write-backs for a "Spiel starten" live game, (separately again) manual bracket-scoring
 * taps made directly in the Tournament.tsx admin UI (declare winner, +1 leg, reset a match),
 * and league_fixtures write-backs. Four independent IndexedDB object stores, same durable
 * enqueue → flush-on-reconnect shape.
 *
 * The league fixture queue (added in Round 3) revisits a deliberate trade-off documented in
 * useLeagueLink.ts's own doc comment: the league write-back was originally left unqueued as
 * "lower-stakes casual scheduling ... fixable by hand afterward", to avoid growing Game.tsx's
 * already-large tournament-link surface further. The Round 3 backend audit found this meant a
 * league result can be silently lost (no toast, no retry, `console.error` only) on the exact
 * same kind of connection drop the tournament path already handles safely — same bug class as
 * the tournament link, just at a second site. Addressed here the same additive, isolated way
 * the original comment's concern was about avoiding (a few lines wired into the existing
 * leagueLink block, not a restructuring), via the shared createQueue() factory below.
 */

const DB_NAME = "darts-offline-queue";
const DB_VERSION = 4;
const GAME_STORE = "pending_game_saves";
const MATCH_RESULT_STORE = "pending_match_results";
const BRACKET_ACTION_STORE = "pending_bracket_actions";
const LEAGUE_FIXTURE_RESULT_STORE = "pending_league_fixture_results";

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

/** One queued manual bracket-scoring tap — see BracketActionPayload's own doc comment for why
 *  this carries the action's *intent* (matchId/winner/slot) rather than a precomputed bracket. */
export interface QueuedBracketAction {
  id: string;
  tournamentId: string;
  action: BracketActionPayload;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

/** One queued league_fixtures write-back — either a Game.tsx "Spiel starten" league match that
 *  finished, or a League.tsx manual result entry, whichever failed to reach Supabase directly.
 *  Carries the update's *values*, not a precomputed row, same reasoning as QueuedBracketAction. */
export interface QueuedLeagueFixtureResult {
  id: string;
  fixtureId: string;
  winnerId: string | null;
  player1LegsWon: number;
  player2LegsWon: number;
  /** Set only for the Game.tsx live-play path, so the replay can also stamp the fixture with the
   *  game it came from — absent for League.tsx's manual entry, which has no game row at all. */
  gameId?: string;
  /** Game.tsx's write only ever applies to a still-`pending` fixture (guards against double-
   *  applying if the user somehow triggers two saves); League.tsx's manual entry has no such
   *  guard today (an admin correcting an already-finished fixture is a legitimate case there). */
  guardPending: boolean;
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
      if (!db.objectStoreNames.contains(BRACKET_ACTION_STORE)) db.createObjectStore(BRACKET_ACTION_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(LEAGUE_FIXTURE_RESULT_STORE)) db.createObjectStore(LEAGUE_FIXTURE_RESULT_STORE, { keyPath: "id" });
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

const bracketActionQueue = createQueue<QueuedBracketAction>(BRACKET_ACTION_STORE);

export const enqueueBracketAction = bracketActionQueue.enqueue;
export const listQueuedBracketActions = bracketActionQueue.list;
export const subscribeBracketActionQueueCount = bracketActionQueue.subscribeCount;

export async function flushBracketActionQueue(
  replay: (tournamentId: string, action: BracketActionPayload) => Promise<unknown>
): Promise<{ synced: number; failed: number }> {
  return bracketActionQueue.flush((item) => replay(item.tournamentId, item.action).then(() => undefined));
}

const leagueFixtureResultQueue = createQueue<QueuedLeagueFixtureResult>(LEAGUE_FIXTURE_RESULT_STORE);

export const enqueueLeagueFixtureResult = leagueFixtureResultQueue.enqueue;
export const listQueuedLeagueFixtureResults = leagueFixtureResultQueue.list;
export const subscribeLeagueFixtureResultQueueCount = leagueFixtureResultQueue.subscribeCount;

export async function flushLeagueFixtureResultQueue(
  replay: (fixtureId: string, result: { winnerId: string | null; player1LegsWon: number; player2LegsWon: number; gameId?: string; guardPending: boolean }) => Promise<void>
): Promise<{ synced: number; failed: number }> {
  return leagueFixtureResultQueue.flush((item) =>
    replay(item.fixtureId, { winnerId: item.winnerId, player1LegsWon: item.player1LegsWon, player2LegsWon: item.player2LegsWon, gameId: item.gameId, guardPending: item.guardPending })
  );
}
