import { describe, expect, it } from "vitest";
import { normalizePresetConfig, overlaySlots, describePreset, loadLastGameSetup, saveLastGameSetup } from "./gamePreset";

describe("normalizePresetConfig", () => {
  it("falls back to defaults for garbage and clamps numbers", () => {
    const c = normalizePresetConfig({ mode: "nope", numPlayers: 99, bestOfLegs: "x", playerBotLevel: ["hard", "zzz"] });
    expect(c.mode).toBe("501");
    expect(c.numPlayers).toBe(8);
    expect(c.bestOfLegs).toBe(3);
    expect(c.playerBotLevel).toEqual(["hard"]);
    expect(normalizePresetConfig(null).numPlayers).toBe(2);
  });

  it("keeps valid values and only as many slots as players", () => {
    const c = normalizePresetConfig({ mode: "301", numPlayers: 2, playerNames: ["A", "B", "C"], playerDoubleOut: [true, false, true] });
    expect(c.mode).toBe("301");
    expect(c.playerNames).toEqual(["A", "B"]);
    expect(c.playerDoubleOut).toEqual([true, false]);
  });

  it("reads Master Out per slot; an older preset without it is plain double or single out", () => {
    expect(normalizePresetConfig({ numPlayers: 2, playerDoubleOut: [true, false] }).playerMasterOut).toEqual([false, false]);
    expect(normalizePresetConfig({ numPlayers: 2, playerDoubleOut: [true, true], playerMasterOut: [true, false] }).playerMasterOut).toEqual([true, false]);
    // never Master Out on a single-out slot, and garbage is ignored
    expect(normalizePresetConfig({ numPlayers: 2, playerDoubleOut: [false, true], playerMasterOut: [true, "yes"] }).playerMasterOut).toEqual([false, false]);
  });
});

describe("overlaySlots / describePreset", () => {
  it("overlays saved slots and keeps the rest", () => {
    expect(overlaySlots([1, 2, 3, 4], [9, 8])).toEqual([9, 8, 3, 4]);
  });
  it("describes the preset in one line", () => {
    expect(describePreset(normalizePresetConfig({ mode: "501", bestOfLegs: 3, numPlayers: 2 }), "First to", "Spieler")).toBe("501 · First to 2 · 2 Spieler");
  });
});

describe("last game setup (Wie letztes Mal)", () => {
  it("stores the last setup per account and reads it back normalized", () => {
    window.localStorage.clear();
    const config = normalizePresetConfig({ mode: "301", numPlayers: 3, bestOfLegs: 5, playerNames: ["A", "B", "C"] });
    saveLastGameSetup("user-1", config);
    expect(loadLastGameSetup("user-1")).toEqual(config);
    expect(loadLastGameSetup("user-2")).toBeNull();
  });
  it("does nothing without an account and survives broken storage", () => {
    window.localStorage.clear();
    saveLastGameSetup(undefined, normalizePresetConfig({}));
    expect(loadLastGameSetup(undefined)).toBeNull();
    window.localStorage.setItem("dart-last-game-setup:user-3", "{not json");
    expect(loadLastGameSetup("user-3")).toBeNull();
  });
});
