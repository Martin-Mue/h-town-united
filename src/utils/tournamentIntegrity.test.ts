import { describe, it, expect } from "vitest";
import { recomputeBracket, calcStandings, fillByeSlot, resultWinnerFor, BYE, type Match, type RoundRobinMatch } from "./tournament";
import { applyActionToKoBracket } from "@/lib/tournamentMatchSync";

/** A four-player bracket in which A beat B, C beat D, and C won the final 3:1 against A. */
const playedBracket = (): Match[] => [
  { id: "r1-0", round: 1, position: 0, player1: "A", player2: "B", winner: "A", score1: 2, score2: 0 },
  { id: "r1-1", round: 1, position: 1, player1: "C", player2: "D", winner: "C", score1: 2, score2: 1 },
  { id: "r2-0", round: 2, position: 0, player1: "A", player2: "C", winner: "C", score1: 1, score2: 3 },
];
const ctx = { defaultBestOf: 3, boards: 2 };

describe("a result only stands while its pairing stands", () => {
  it("resetting an earlier match clears the later match the loser of it played in", () => {
    const reset = applyActionToKoBracket(playedBracket(), { type: "resetKoMatch", matchId: "r1-0" }, ctx)!;
    const final = recomputeBracket(reset).find((m) => m.id === "r2-0")!;
    expect(final.player1).toBeUndefined();
    expect(final.player2).toBe("C");
    expect(final.winner).toBeUndefined();
    expect(final.score1).toBeUndefined();
    expect(final.score2).toBeUndefined();
  });

  it("the final has to be played again when the other semi-final gets a different winner", () => {
    const reset = recomputeBracket(applyActionToKoBracket(playedBracket(), { type: "resetKoMatch", matchId: "r1-0" }, ctx)!);
    const redecided = recomputeBracket(applyActionToKoBracket(reset, { type: "setKoWinner", matchId: "r1-0", winner: "B" }, ctx)!);
    const final = redecided.find((m) => m.id === "r2-0")!;
    expect([final.player1, final.player2]).toEqual(["B", "C"]);
    expect(final.winner).toBeUndefined();
  });

  it("leaves every result alone when nothing about the pairings changed", () => {
    expect(recomputeBracket(playedBracket())).toEqual(playedBracket());
  });

  it("keeps a walkover against a BYE", () => {
    const bracket: Match[] = [
      { id: "r1-0", round: 1, position: 0, player1: "A", player2: BYE },
      { id: "r1-1", round: 1, position: 1, player1: "C", player2: "D" },
      { id: "r2-0", round: 2, position: 0 },
    ];
    const once = recomputeBracket(bracket);
    expect(once.find((m) => m.id === "r1-0")!.winner).toBe("A");
    expect(recomputeBracket(once).find((m) => m.id === "r2-0")!.player1).toBe("A");
  });
});

describe("no more legs on a decided match", () => {
  it("ignores a +1 after the match has a winner", () => {
    expect(applyActionToKoBracket(playedBracket(), { type: "setKoScore", matchId: "r1-0", slot: 2 }, ctx)).toBeNull();
  });
});

describe("a late sign-up takes only a bye that is still free", () => {
  const withBye = (finalStarted: boolean): Match[] => [
    { id: "r1-0", round: 1, position: 0, player1: "A", player2: BYE, winner: "A" },
    { id: "r1-1", round: 1, position: 1, player1: "C", player2: "D", winner: "C" },
    { id: "r2-0", round: 2, position: 0, player1: "A", player2: "C", ...(finalStarted ? { winner: "A", score1: 2, score2: 0 } : {}) },
  ];

  it("fills the bye while the next match has not begun", () => {
    const filled = fillByeSlot(withBye(false), "New")!;
    expect(filled.find((m) => m.id === "r1-0")).toMatchObject({ player1: "A", player2: "New", winner: undefined });
  });

  it("refuses once the player with the bye has played on", () => {
    expect(fillByeSlot(withBye(true), "New")).toBeNull();
  });
});

describe("resultWinnerFor", () => {
  const match = { player1: "Anna", player2: "Ben" };
  it("takes the reported name when it is one of the two players", () => {
    expect(resultWinnerFor(match, { winnerName: "Ben" })).toBe("Ben");
  });
  it("falls back to the leg score when the name fits neither player", () => {
    expect(resultWinnerFor(match, { winnerName: "Benni", score1: 1, score2: 3 })).toBe("Ben");
  });
  it("refuses a result it cannot assign", () => {
    expect(() => resultWinnerFor(match, { winnerName: "Benni" })).toThrow();
    expect(() => resultWinnerFor(match, { winnerName: "Benni", score1: 2, score2: 2 })).toThrow();
  });
});

describe("calcStandings", () => {
  it("survives a winner who is neither player of the match", () => {
    const matches: RoundRobinMatch[] = [
      { id: "1", player1: "A", player2: "B", played: true, winner: "A" },
      { id: "2", player1: "A", player2: "C", played: true, winner: "Ghost" },
    ];
    const table = calcStandings(matches);
    expect(table[0]).toMatchObject({ name: "A", won: 1, played: 1 });
    expect(table.map((s) => s.name).sort()).toEqual(["A", "B", "C"]);
  });
});

describe("walkover after a withdrawal", () => {
  it("is marked, so it does not count as a played match, and the mark goes when the match is reset", () => {
    const bracket: Match[] = [{ id: "r1-0", round: 1, position: 0, player1: "A", player2: "B" }];
    const afterWithdrawal = recomputeBracket(bracket, ["A"]);
    expect(afterWithdrawal[0]).toMatchObject({ winner: "A", walkover: true });
    const reset = recomputeBracket([{ ...afterWithdrawal[0], winner: undefined }], ["A", "B"]);
    expect(reset[0].walkover).toBeUndefined();
  });
});
