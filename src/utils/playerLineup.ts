import { outRuleOf, type OutRule } from "./x01Rules";

/**
 * Pure helpers for the new-game screen's player lineup. The setup keeps one entry per player slot in
 * parallel arrays (names, bot flags, levels, …), each MAX_PLAYERS long; only the first `numPlayers`
 * slots take part. Slot order is the throw order: play always passes to slot + 1, starting at the
 * starter (see startGameWithStarter in Game.tsx).
 */

/** Which slot opens leg 1 — the same clamping startGameWithStarter() applies. */
export function effectiveStarterSlot(numPlayers: number, starterIndex: number, teamMode: boolean): number {
  if (numPlayers <= 0) return 0;
  if (teamMode) return starterIndex % 2 === 0 ? 0 : 1;
  return Math.min(Math.max(0, starterIndex), numPlayers - 1);
}

/** Throw position (1 = throws first) of every active slot in leg 1. */
export function throwOrderBySlot(numPlayers: number, starterIndex: number, teamMode: boolean): number[] {
  const starter = effectiveStarterSlot(numPlayers, starterIndex, teamMode);
  return Array.from({ length: numPlayers }, (_, slot) => ((slot - starter + numPlayers) % numPlayers) + 1);
}

/** "Spieler 3" style default names (and empty fields) mean nobody has been put into that slot yet. */
export function isPlaceholderName(name: string | undefined): boolean {
  const trimmed = (name ?? "").trim();
  return trimmed === "" || /^Spieler \d+$/.test(trimmed);
}

/** The active slot a club member already sits in, or -1. Bot slots never count as the member. */
export function slotOfMember(memberName: string, names: string[], isBot: boolean[], numPlayers: number): number {
  for (let i = 0; i < numPlayers; i++) {
    if (!isBot[i] && names[i] === memberName) return i;
  }
  return -1;
}

/** The first active human slot that has no real name yet, or -1. */
export function firstFreeSlot(names: string[], isBot: boolean[], numPlayers: number): number {
  for (let i = 0; i < numPlayers; i++) {
    if (!isBot[i] && isPlaceholderName(names[i])) return i;
  }
  return -1;
}

/** Takes one slot out and closes the gap; `filler` goes to the end so the array keeps its length. */
export function removeSlotAt<T>(values: T[], index: number, filler: T): T[] {
  if (index < 0 || index >= values.length) return values;
  return [...values.slice(0, index), ...values.slice(index + 1), filler];
}

/** Keeps the same player as starter after a slot was removed (falls back to the first slot if the starter left). */
export function starterAfterRemoval(starterIndex: number, removedSlot: number, numPlayersBefore: number): number {
  if (removedSlot < starterIndex) return starterIndex - 1;
  if (removedSlot === starterIndex) return 0;
  return Math.min(starterIndex, Math.max(0, numPlayersBefore - 2));
}

export type CheckoutRule = OutRule | "mixed";

/** The out rule of one setup slot: the Master Out flag wins over the double-out switch. */
export function slotOutRule(doubleOut: boolean[], masterOut: boolean[], slot: number): OutRule {
  return outRuleOf({ doubleOut: doubleOut[slot], masterOut: masterOut[slot] });
}

/** The two setup values a slot holds for an out rule (Master Out is stored together with double-out on). */
export function outRuleFlags(rule: OutRule): { doubleOut: boolean; masterOut: boolean } {
  return { doubleOut: rule !== "single", masterOut: rule === "master" };
}

/** The out rule shared by every active slot, or "mixed" when players were set differently. */
export function sharedCheckoutRule(doubleOut: boolean[], numPlayers: number, masterOut: boolean[] = []): CheckoutRule {
  const active = Array.from({ length: Math.min(numPlayers, doubleOut.length) }, (_, slot) => slotOutRule(doubleOut, masterOut, slot));
  if (active.length === 0) return "double";
  return active.every((rule) => rule === active[0]) ? active[0] : "mixed";
}

/** bestOfLegs is stored as "best of"; the screen talks in "first to". */
export const firstToFromBestOf = (bestOf: number): number => Math.ceil(bestOf / 2);
export const bestOfFromFirstTo = (firstTo: number): number => firstTo * 2 - 1;
