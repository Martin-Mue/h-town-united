import type { BotLevel, GameMode } from "@/types/game";

/** A saved snapshot of the new-game setup. Per-player lists hold one entry per player slot, in slot order. */
export interface GamePresetConfig {
  mode: GameMode;
  customStartScore: number;
  teamMode: boolean;
  numPlayers: number;
  bestOfLegs: number;
  setsEnabled: boolean;
  bestOfSets: number;
  checkoutSuggestionEnabled: boolean;
  maxRoundsX01: number;
  customCricket: boolean;
  warmupEnabled: boolean;
  walkonEnabled: boolean;
  playerNames: string[];
  playerIsBot: boolean[];
  playerBotLevel: BotLevel[];
  playerDoubleIn: boolean[];
  playerDoubleOut: boolean[];
  playerHandicap: number[];
}

const MODES: GameMode[] = ["501", "301", "cricket", "custom"];
const BOT_LEVELS: BotLevel[] = ["easy", "medium", "hard", "elite", "legendary"];

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const list = <T,>(v: unknown, count: number, ok: (x: unknown) => x is T): T[] =>
  Array.isArray(v) ? v.slice(0, count).filter(ok) : [];

/**
 * Reads a stored preset defensively: it comes out of a JSON column, so a field may be missing or from an older
 * version of the app. Anything unusable falls back to a plain default instead of breaking the setup screen.
 */
export function normalizePresetConfig(raw: unknown): GamePresetConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const numPlayers = num(r.numPlayers, 2, 1, 8);
  return {
    mode: MODES.includes(r.mode as GameMode) ? (r.mode as GameMode) : "501",
    customStartScore: num(r.customStartScore, 501, 2, 9999),
    teamMode: bool(r.teamMode, false),
    numPlayers,
    bestOfLegs: num(r.bestOfLegs, 3, 1, 99),
    setsEnabled: bool(r.setsEnabled, false),
    bestOfSets: num(r.bestOfSets, 3, 1, 99),
    checkoutSuggestionEnabled: bool(r.checkoutSuggestionEnabled, true),
    maxRoundsX01: num(r.maxRoundsX01, 0, 0, 99),
    customCricket: bool(r.customCricket, false),
    warmupEnabled: bool(r.warmupEnabled, false),
    walkonEnabled: bool(r.walkonEnabled, true),
    playerNames: list(r.playerNames, numPlayers, (x): x is string => typeof x === "string"),
    playerIsBot: list(r.playerIsBot, numPlayers, (x): x is boolean => typeof x === "boolean"),
    playerBotLevel: list(r.playerBotLevel, numPlayers, (x): x is BotLevel => BOT_LEVELS.includes(x as BotLevel)),
    playerDoubleIn: list(r.playerDoubleIn, numPlayers, (x): x is boolean => typeof x === "boolean"),
    playerDoubleOut: list(r.playerDoubleOut, numPlayers, (x): x is boolean => typeof x === "boolean"),
    playerHandicap: list(r.playerHandicap, numPlayers, (x): x is number => typeof x === "number" && Number.isFinite(x)),
  };
}

/** Puts saved per-slot values over the current ones; slots the preset does not know keep their current value. */
export const overlaySlots = <T,>(current: T[], saved: T[]): T[] => current.map((value, i) => (i < saved.length ? saved[i] : value));

/** One line for the chip: "501 · First to 2 · 2 Spieler". */
export function describePreset(config: GamePresetConfig, firstToLabel: string, playersLabel: string): string {
  const mode = config.mode === "custom" ? String(config.customStartScore) : config.mode === "cricket" ? "Cricket" : config.mode;
  return `${mode} · ${firstToLabel} ${Math.ceil(config.bestOfLegs / 2)} · ${config.numPlayers} ${playersLabel}`;
}
