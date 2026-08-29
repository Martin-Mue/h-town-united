import { describe, it, expect } from "vitest";
import { recomputeBracket, calcStandings, assignScorekeepers, currentBoardSchedule, BYE, type Match, type RoundRobinMatch } from "./tournament";

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

describe("assignScorekeepers", () => {
  it("does not keep a withdrawn player's existing unlocked scorekeeper assignment", () => {
    const matches: Match[] = [
      { id: "r1-0", round: 1, position: 0, player1: "A", player2: "B", winner: "A" },
      // Stale state: B was auto-assigned here before withdrawing — no longer in `participants`
      // below, but still sitting in scorekeeper from the last assignment run.
      { id: "r1-1", round: 1, position: 1, player1: "C", player2: "D", scorekeeper: "B" },
    ];
    const result = assignScorekeepers(matches, ["A", "C", "D"], { boards: 1, keepExisting: true });
    expect(result.find((m) => m.id === "r1-1")!.scorekeeper).not.toBe("B");
  });
});

describe("currentBoardSchedule", () => {
  it("advances a board to its own next match as soon as it's decided, without waiting for a sibling board", () => {
    // 4 first-round matches, 2 boards: m0/m1 share the first slot (board 1/2), m2/m3 the second.
    const matches: Match[] = [
      { id: "m0", round: 1, position: 0, player1: "A", player2: "B" },
      { id: "m1", round: 1, position: 1, player1: "C", player2: "D" },
      { id: "m2", round: 1, position: 2, player1: "E", player2: "F" },
      { id: "m3", round: 1, position: 3, player1: "G", player2: "H" },
    ];
    // Board 1's opening match (m0) finishes while board 2's (m1) is still undecided — this used
    // to leave board 1 stuck showing nothing until m1 *also* finished, because both were grouped
    // into the same "slot" and a slot only advanced once every board in it was decided (the real
    // bug: several boards at a tournament had to wait on each other instead of each picking up
    // its own next match).
    const decided = matches.map((m) => (m.id === "m0" ? { ...m, winner: "A" } : m));
    const schedule = currentBoardSchedule(decided, 2);

    expect(schedule.now.find((e) => e.board === 1)?.match.id).toBe("m2");
    expect(schedule.now.find((e) => e.board === 2)?.match.id).toBe("m1");
    expect(schedule.onDeck.find((e) => e.board === 2)?.match.id).toBe("m3");
    expect(schedule.queuedCount).toBe(0);
  });

  it("keeps both boards on their first match before anything is decided", () => {
    const matches: Match[] = [
      { id: "m0", round: 1, position: 0, player1: "A", player2: "B" },
      { id: "m1", round: 1, position: 1, player1: "C", player2: "D" },
    ];
    const schedule = currentBoardSchedule(matches, 2);
    expect(schedule.now.map((e) => e.match.id).sort()).toEqual(["m0", "m1"]);
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
