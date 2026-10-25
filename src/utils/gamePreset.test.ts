import { describe, expect, it } from "vitest";
import { normalizePresetConfig, overlaySlots, describePreset } from "./gamePreset";

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
});

describe("overlaySlots / describePreset", () => {
  it("overlays saved slots and keeps the rest", () => {
    expect(overlaySlots([1, 2, 3, 4], [9, 8])).toEqual([9, 8, 3, 4]);
  });
  it("describes the preset in one line", () => {
    expect(describePreset(normalizePresetConfig({ mode: "501", bestOfLegs: 3, numPlayers: 2 }), "First to", "Spieler")).toBe("501 · First to 2 · 2 Spieler");
  });
});
