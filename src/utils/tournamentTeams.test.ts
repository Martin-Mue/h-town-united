import { describe, it, expect } from "vitest";
import { isTeamName, makeTeamName, splitTeamName, pairIntoTeams, dissolveTeams } from "./tournamentTeams";

describe("tournamentTeams", () => {
  it("builds, detects and splits team names", () => {
    const n = makeTeamName("Anna", "Ben");
    expect(n).toBe("Anna & Ben");
    expect(isTeamName(n)).toBe(true);
    expect(isTeamName("Anna")).toBe(false);
    expect(splitTeamName(n)).toEqual(["Anna", "Ben"]);
  });
  it("pairs in order and returns the odd one out", () => {
    const r = pairIntoTeams(["A", "B", "C", "D", "E"], "order");
    expect(r.teams).toEqual(["A & B", "C & D"]);
    expect(r.leftover).toBe("E");
  });
  it("balances strongest with weakest", () => {
    const rating: Record<string, number> = { A: 1500, B: 1400, C: 1300, D: 1200 };
    const r = pairIntoTeams(["B", "D", "A", "C"], "balanced", { rating: (n) => rating[n] });
    expect(r.teams).toEqual(["A & D", "B & C"]);
  });
  it("random keeps everyone exactly once", () => {
    const r = pairIntoTeams(["A", "B", "C", "D"], "random", { random: () => 0.3 });
    expect(dissolveTeams(r.teams).sort()).toEqual(["A", "B", "C", "D"]);
  });
});
