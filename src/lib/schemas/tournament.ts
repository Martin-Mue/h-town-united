import { z } from "zod";
import type { Match, RoundRobinMatch } from "@/utils/tournament";

/**
 * Round 3 Rang 5: runtime validation for the tournaments table's JSONB columns
 * (`players`, `bracket`, `round_configs`, `attendance`, `prestart_views`).
 *
 * These columns are typed `Json` by Supabase's generated types — the actual shape (Match[],
 * RoundRobinMatch[], ...) only ever existed as a blind `as unknown as X` cast at each read site,
 * meaning a hand-edited row, a partially-applied migration, or a future bug that writes the wrong
 * shape would silently produce garbage `Match`/`RoundRobinMatch` objects instead of a caught error
 * — the audit's "96 unsichere Typ-Casts" item, worst offender: Tournament.tsx (~36 of them).
 *
 * These schemas intentionally validate STRUCTURE, not exhaustively every field: unknown extra keys
 * are kept (`.passthrough()`) so a newer app version's extra field doesn't get silently stripped
 * when read by this one, and every schema stays a hand-kept mirror of the interfaces in
 * utils/tournament.ts (not the other way around — those interfaces remain the single source of
 * truth for the app's own code; this file only decides whether DATA COMING BACK FROM SUPABASE is
 * safe to treat as that shape).
 *
 * Every parseX() below is deliberately forgiving at the collection level: a single malformed
 * bracket match drops just that match (logged), not the entire bracket — for a live tournament,
 * silently losing one corrupt match is far less damaging than the previous behavior (an unvalidated
 * cast that could hand the rest of the app a garbage object it then crashes on) or a new failure
 * mode (nuking every OTHER, perfectly valid match because one was bad).
 */

const liveSnapshotSchema = z
  .object({
    remaining1: z.number().optional(),
    remaining2: z.number().optional(),
    legs1: z.number(),
    legs2: z.number(),
    updatedAt: z.string(),
  })
  .passthrough();

const matchSchema = z
  .object({
    id: z.string(),
    round: z.number(),
    position: z.number(),
    player1: z.string().optional(),
    player2: z.string().optional(),
    winner: z.string().optional(),
    score1: z.number().optional(),
    score2: z.number().optional(),
    table: z.number().optional(),
    scorekeeper: z.string().optional(),
    scorekeeperLocked: z.boolean().optional(),
    scorekeeperRule: z.literal("prev-loser").optional(),
    scorekeeperFromMatchId: z.string().optional(),
    board: z.number().optional(),
    slot: z.number().optional(),
    feedsRound1Position: z.number().optional(),
    feedsRound1Slot: z.union([z.literal(1), z.literal(2)]).optional(),
    live: liveSnapshotSchema.optional(),
  })
  .passthrough();

const roundRobinMatchSchema = z
  .object({
    id: z.string(),
    player1: z.string(),
    player2: z.string(),
    winner: z.string().optional(),
    played: z.boolean(),
    board: z.number().optional(),
    scorekeeper: z.string().optional(),
    scorekeeperLocked: z.boolean().optional(),
    live: liveSnapshotSchema.optional(),
  })
  .passthrough();

// A KO Match and an RR RoundRobinMatch aren't distinguished by any field of their own — only by
// which tournament.mode the bracket belongs to (checked by whoever calls parseBracket, exactly
// like the pre-existing `as Match[]` / `as RoundRobinMatch[]` casts already did). Structurally
// they're still tell-apart-able: RoundRobinMatch requires `played` and has no `round`/`position`,
// Match requires `round`/`position` and has no `played` — so the union below rejects an entry that
// matches neither shape instead of silently accepting anything with an `id`.
const bracketMatchSchema = z.union([matchSchema, roundRobinMatchSchema]);

const roundConfigSchema = z
  .object({
    mode: z.string(),
    bestOf: z.number(),
  })
  .passthrough();

export type RoundConfig = z.infer<typeof roundConfigSchema>;

const ROTATION_SLOTS = ["boards", "bracket", "participants", "highlights", "waiting", "format", "qr"] as const;
const rotationSlotSchema = z.enum(ROTATION_SLOTS);

function logInvalid(context: string | undefined, label: string, detail: unknown) {
  console.error(`[tournament schema] invalid ${label}${context ? ` (${context})` : ""}`, detail);
}

/** `tournaments.players` — the free-text participant name list. */
export function parsePlayers(raw: unknown, context?: string): string[] {
  if (raw === null || raw === undefined) return [];
  const result = z.array(z.string()).safeParse(raw);
  if (!result.success) {
    logInvalid(context, "players", result.error.flatten());
    return [];
  }
  return result.data;
}

/**
 * `tournaments.bracket` — KO and RR share this column (mode-dependent shape), so this returns the
 * union type; callers narrow with `as Match[]` / `as RoundRobinMatch[]` exactly as before, but now
 * on data that's actually been checked to look like one of those two shapes, not blind JSON.
 * Drops (and logs) individual entries that match neither shape instead of discarding the whole
 * bracket over one bad match.
 */
export function parseBracket(raw: unknown, context?: string): (Match | RoundRobinMatch)[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) {
    logInvalid(context, "bracket (not an array)", raw);
    return [];
  }
  const valid: (Match | RoundRobinMatch)[] = [];
  let droppedCount = 0;
  for (const entry of raw) {
    const result = bracketMatchSchema.safeParse(entry);
    if (result.success) {
      valid.push(result.data as Match | RoundRobinMatch);
    } else {
      droppedCount++;
    }
  }
  if (droppedCount > 0) {
    logInvalid(context, `bracket match(es) — dropped ${droppedCount} of ${raw.length}`, raw);
  }
  return valid;
}

/** `tournaments.round_configs` — per-round mode/best-of override list. */
export function parseRoundConfigs(raw: unknown, context?: string): RoundConfig[] {
  if (raw === null || raw === undefined) return [];
  const result = z.array(roundConfigSchema).safeParse(raw);
  if (!result.success) {
    logInvalid(context, "round_configs", result.error.flatten());
    return [];
  }
  return result.data;
}

/** `tournaments.attendance` — organizer check-in state, keyed by participant name. */
export function parseAttendance(raw: unknown, context?: string): Record<string, boolean> {
  if (raw === null || raw === undefined) return {};
  const result = z.record(z.string(), z.boolean()).safeParse(raw);
  if (!result.success) {
    logInvalid(context, "attendance", result.error.flatten());
    return {};
  }
  return result.data;
}

/**
 * `tournaments.prestart_views` — which live-view slides stay visible before the first result.
 * Unknown slot names (e.g. from a future app version, or corrupted data) are dropped individually
 * rather than invalidating the whole list, then the caller's own fallback (DEFAULT_PRESTART_VIEWS)
 * applies if that leaves nothing valid at all.
 */
export function parsePrestartViews(raw: unknown, fallback: string[], context?: string): string[] {
  if (raw === null || raw === undefined) return fallback;
  if (!Array.isArray(raw)) {
    logInvalid(context, "prestart_views (not an array)", raw);
    return fallback;
  }
  const valid = raw.filter((entry) => rotationSlotSchema.safeParse(entry).success) as string[];
  if (valid.length !== raw.length) {
    logInvalid(context, `prestart_views — dropped ${raw.length - valid.length} unknown slot(s)`, raw);
  }
  return valid.length > 0 ? valid : fallback;
}
