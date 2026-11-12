import { describe, expect, it } from "vitest";
import { describeSetupSummary, type SetupSummaryInput } from "./setupSummary";

const labels = { doubleOut: "Double Out", singleOut: "Single Out", firstTo: "First to", legs: "Legs", sets: "Sätze", players: "Spieler" };
const base: SetupSummaryInput = {
  mode: "501", customStartScore: 501, checkoutRule: "double", bestOfLegs: 5, setsEnabled: false, bestOfSets: 3,
  numPlayers: 2, teamMode: false, inputLabel: "Manuell",
};

describe("describeSetupSummary", () => {
  it("describes a plain X01 game", () => {
    expect(describeSetupSummary(base, labels)).toBe("501 · Double Out · First to 3 Legs · 2 Spieler · Manuell");
  });
  it("uses sets, the custom start score and leaves out a mixed out rule", () => {
    expect(describeSetupSummary({ ...base, mode: "custom", customStartScore: 701, checkoutRule: "mixed", setsEnabled: true }, labels))
      .toBe("701 · First to 2 Sätze · 2 Spieler · Manuell");
  });
  it("cricket has no out rule or distance; team mode shows the team size", () => {
    expect(describeSetupSummary({ ...base, mode: "cricket", teamMode: true, numPlayers: 4, inputLabel: "Autodarts" }, labels))
      .toBe("Cricket · 2 vs 2 · Autodarts");
  });
});
