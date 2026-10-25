import { describe, expect, it } from "vitest";
import { describeResumableGame, findNextTournamentMatch, type TournamentLite } from "./homeHighlights";
import type { GameState } from "@/types/game";

const ko = (bracket: unknown[], extra: Partial<TournamentLite> = {}): TournamentLite => ({ id: "t1", name: "Oktober", mode: "ko", status: "active", bracket, ...extra });

describe("findNextTournamentMatch", () => {
  it("finds the lowest unfinished round the player is in", () => {
    const t = ko([
      { id: "a", round: 1, position: 0, player1: "Anna", player2: "Ben", winner: "Anna" },
      { id: "b", round: 2, position: 0, player1: "Anna", player2: "Cara" },
      { id: "c", round: 3, position: 0 },
    ]);
    expect(findNextTournamentMatch([t], "Anna")).toEqual({ tournamentId: "t1", tournamentName: "Oktober", opponent: "Cara", round: 2, totalRounds: 3 });
  });

  it("returns the match with an unknown opponent while the other semi-final is running", () => {
    const t = ko([{ id: "b", round: 2, position: 0, player1: "Anna" }, { id: "c", round: 3, position: 0 }]);
    expect(findNextTournamentMatch([t], "Anna")?.opponent).toBeNull();
  });

  it("ignores bye matches, eliminated players, finished tournaments and unknown names", () => {
    const bye = ko([{ id: "a", round: 1, position: 0, player1: "Anna", player2: "BYE" }]);
    expect(findNextTournamentMatch([bye], "Anna")).toBeNull();
    const out = ko([{ id: "a", round: 1, position: 0, player1: "Anna", player2: "Ben", winner: "Ben" }]);
    expect(findNextTournamentMatch([out], "Anna")).toBeNull();
    const done = ko([{ id: "a", round: 1, position: 0, player1: "Anna", player2: "Ben" }], { status: "finished" });
    expect(findNextTournamentMatch([done], "Anna")).toBeNull();
    expect(findNextTournamentMatch([out], "  ")).toBeNull();
  });

  it("finds a member of a doubles team and the first open round-robin pairing", () => {
    const doubles = ko([{ id: "a", round: 1, position: 0, player1: "Anna & Ben", player2: "Cara & Dan" }]);
    expect(findNextTournamentMatch([doubles], "Ben")?.opponent).toBe("Cara & Dan");
    const rr: TournamentLite = { id: "r", name: "Liga-Abend", mode: "round-robin", status: "active", bracket: [
      { id: "1", player1: "Anna", player2: "Ben", played: true, winner: "Anna" },
      { id: "2", player1: "Cara", player2: "Anna", played: false },
    ] };
    expect(findNextTournamentMatch([rr], "Anna")).toMatchObject({ tournamentId: "r", opponent: "Cara", round: null });
  });
});

describe("describeResumableGame", () => {
  const base = { mode: "501", startScore: 501, bestOfLegs: 1, players: [{ name: "Martin", doubleOut: true, isBot: false }, { name: "Bot", doubleOut: true, isBot: true }], legsWon: [0, 0], completedLegs: [], currentPlayerIndex: 0, isFinished: false, currentLeg: { legNumber: 1, startingPlayerIndex: 0, remaining: [276, 376], throws: [[], []] } } as unknown as GameState;

  it("shows names, scores and whose turn it is", () => {
    expect(describeResumableGame(base)).toEqual({ names: ["Martin", "Bot"], scores: [276, 376], isCricket: false, activeName: "Martin" });
  });

  it("offers nothing for a finished or missing game", () => {
    expect(describeResumableGame({ ...base, isFinished: true })).toBeNull();
    expect(describeResumableGame(null)).toBeNull();
  });
});
