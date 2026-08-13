import { describe, it, expect } from "vitest";
import { recomputeBracket, calcStandings, BYE, type Match, type RoundRobinMatch } from "./tournament";

describe("recomputeBracket", () => {
  it("propagates round winners into the next round", () => {
    const matches: Match[] = [
      { id: "r1-0", round: 1, position: 0, player1: "A", player2: "B", winner: "A" },
      { id: "r1-1", round: 1, position: 1, player1: "C", player2: "D", winner: "C" },
      { id: "r2-0", round: 2, position: 0 },
    ];
    const result = recomputeBracket(matches);
    const final = result.find((m) => m.id === "r2-0")!;
    expect(final.player1).toBe("A");
    expect(final.player2).toBe("C");
  });

  it("auto-resolves a BYE as a walkover for the real player", () => {
    const matches: Match[] = [{ id: "r1-0", round: 1, position: 0, player1: "A", player2: BYE }];
    const result = recomputeBracket(matches);
    expect(result[0].winner).toBe("A");
  });

  it("invalidates a downstream winner once their feeding match's result changes", () => {
    const matches: Match[] = [
      { id: "r1-0", round: 1, position: 0, player1: "A", player2: "B", winner: "E" }, // stale: E isn't a participant
      { id: "r2-0", round: 2, position: 0, player1: "A", winner: "A" }, // stale winner from a since-changed player1
    ];
    const result = recomputeBracket(matches);
    expect(result.find((m) => m.id === "r1-0")!.winner).toBeUndefined();
    const final = result.find((m) => m.id === "r2-0")!;
    // r1-0 has no winner anymore, so r2-0.player1 becomes undefined too — the stale "A" winner must be cleared
    expect(final.player1).toBeUndefined();
    expect(final.winner).toBeUndefined();
  });

  it("awards a withdrawn player's opponent a walkover once the opponent becomes known, without touching already-decided history", () => {
    let matches: Match[] = [
      { id: "r1-0", round: 1, position: 0, player1: "A", player2: "B", winner: "A" },
      { id: "r1-1", round: 1, position: 1, player1: "C", player2: "D" }, // not yet decided
      { id: "r2-0", round: 2, position: 0 },
    ];
    const activePlayers = ["B", "C", "D"]; // A withdrew

    // Phase 1: opponent for r2-0 isn't known yet — must not resolve prematurely, and the
    // already-decided r1-0 must keep its real result (history stays intact).
    matches = recomputeBracket(matches, activePlayers);
    expect(matches.find((m) => m.id === "r1-0")!.winner).toBe("A");
    expect(matches.find((m) => m.id === "r2-0")!.winner).toBeUndefined();

    // Phase 2: the feeder match resolves, so r2-0's opponent is now known — the withdrawn
    // player's slot should now auto-walkover to the opponent.
    matches = matches.map((m) => (m.id === "r1-1" ? { ...m, winner: "C" } : m));
    matches = recomputeBracket(matches, activePlayers);
    const final = matches.find((m) => m.id === "r2-0")!;
    expect(final.player1).toBe("A");
    expect(final.player2).toBe("C");
    expect(final.winner).toBe("C");
  });
});

describe("calcStandings", () => {
  it("ranks by points then wins", () => {
    const matches: RoundRobinMatch[] = [
      { id: "m1", player1: "A", player2: "B", winner: "A", played: true },
      { id: "m2", player1: "A", player2: "C", winner: "A", played: true },
    ];
    const standings = calcStandings(matches);
    expect(standings[0].name).toBe("A");
    expect(standings[0].points).toBe(4);
  });

  it("breaks a points/wins tie using head-to-head results among the tied group", () => {
    const matches: RoundRobinMatch[] = [
      { id: "m1", player1: "A", player2: "B", winner: "A", played: true },
      { id: "m2", player1: "C", player2: "D", winner: "C", played: true },
      { id: "m3", player1: "A", player2: "C", winner: "C", played: true },
      { id: "m4", player1: "B", player2: "D", winner: "B", played: true },
      { id: "m5", player1: "B", player2: "C", winner: "C", played: true },
    ];
    const standings = calcStandings(matches);
    const names = standings.map((s) => s.name);
    // A and B are tied on points (2) and wins (1) — A beat B head-to-head, so A must rank above B
    // despite B having played (and scored) more matches overall.
    expect(names.indexOf("A")).toBeLessThan(names.indexOf("B"));
    expect(names[0]).toBe("C");
    expect(names[names.length - 1]).toBe("D");
  });
});
