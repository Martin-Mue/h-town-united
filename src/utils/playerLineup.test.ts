import { describe, expect, it } from "vitest";
import {
  bestOfFromFirstTo, effectiveStarterSlot, firstFreeSlot, firstToFromBestOf, isPlaceholderName, removeSlotAt,
  sharedCheckoutRule, slotOfMember, starterAfterRemoval, throwOrderBySlot,
} from "./playerLineup";

describe("throwOrderBySlot", () => {
  it("numbers the slots in order when slot 1 starts", () => {
    expect(throwOrderBySlot(3, 0, false)).toEqual([1, 2, 3]);
  });
  it("starts counting at the chosen starter and wraps around", () => {
    expect(throwOrderBySlot(4, 2, false)).toEqual([3, 4, 1, 2]);
  });
  it("clamps a starter beyond the player count like the game start does", () => {
    expect(effectiveStarterSlot(2, 5, false)).toBe(1);
    expect(throwOrderBySlot(2, 5, false)).toEqual([2, 1]);
  });
  it("in team mode the starter only picks the team", () => {
    expect(effectiveStarterSlot(4, 3, true)).toBe(1);
    expect(throwOrderBySlot(4, 3, true)).toEqual([4, 1, 2, 3]);
    expect(throwOrderBySlot(4, 2, true)).toEqual([1, 2, 3, 4]);
  });
});

describe("lineup slots", () => {
  const names = ["Anna", "Spieler 2", "", "Ben"];
  const bots = [false, false, false, true];

  it("treats empty and default names as free", () => {
    expect(isPlaceholderName("Spieler 7")).toBe(true);
    expect(isPlaceholderName("  ")).toBe(true);
    expect(isPlaceholderName("Kalle")).toBe(false);
  });
  it("finds the first free human slot within the active players", () => {
    expect(firstFreeSlot(names, bots, 4)).toBe(1);
    expect(firstFreeSlot(["Anna", "Ben"], [false, false], 2)).toBe(-1);
    expect(firstFreeSlot(["Anna", "Spieler 2"], [false, true], 2)).toBe(-1);
  });
  it("finds a member's slot but never a bot slot", () => {
    expect(slotOfMember("Anna", names, bots, 4)).toBe(0);
    expect(slotOfMember("Ben", names, bots, 4)).toBe(-1);
    expect(slotOfMember("Anna", names, bots, 0)).toBe(-1);
  });
  it("removes a slot and keeps the array length", () => {
    expect(removeSlotAt(["A", "B", "C", "D"], 1, "")).toEqual(["A", "C", "D", ""]);
    expect(removeSlotAt(["A"], 3, "")).toEqual(["A"]);
  });
  it("keeps the same starter after a removal", () => {
    expect(starterAfterRemoval(2, 0, 4)).toBe(1);
    expect(starterAfterRemoval(1, 3, 4)).toBe(1);
    expect(starterAfterRemoval(2, 2, 4)).toBe(0);
  });
});

describe("format helpers", () => {
  it("reads the shared out rule", () => {
    expect(sharedCheckoutRule([true, true, false], 2)).toBe("double");
    expect(sharedCheckoutRule([false, false, true], 2)).toBe("single");
    expect(sharedCheckoutRule([true, false], 2)).toBe("mixed");
  });
  it("converts between best of and first to", () => {
    expect(firstToFromBestOf(5)).toBe(3);
    expect(bestOfFromFirstTo(3)).toBe(5);
    expect(bestOfFromFirstTo(firstToFromBestOf(1))).toBe(1);
  });
});
