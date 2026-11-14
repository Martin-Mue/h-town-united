import { describe, expect, it } from "vitest";
import { manualRecordFor, manualResultsFor, manualTournamentResults, resultFromLegs, type TournamentForStats } from "./tournamentResults";

const ko = (bracket: unknown[]): TournamentForStats => ({ id: "t1", name: "Oktober", mode: "ko", created_at: "2026-10-10T16:00:00Z", bracket });

describe("manualTournamentResults", () => {
  it("takes decided matches without a saved game and skips byes, undecided and saved ones", () => {
    const t = ko([
      { id: "a", round: 1, position: 0, player1: "Martin", player2: "Moritz", winner: "Martin" },
      { id: "b", round: 1, position: 1, player1: "Anna", player2: "Ben", winner: "Anna" },
      { id: "c", round: 1, position: 2, player1: "Cara", player2: "BYE", winner: "Cara" },
      { id: "d", round: 2, position: 0, player1: "Martin", player2: "Anna" },
    ]);
    const results = manualTournamentResults([t], new Set(["t1:b"]));
    expect(results.map((r) => r.key)).toEqual(["t1:a"]);
  });

  it("reads round-robin matches that were played", () => {
    const rr: TournamentForStats = { id: "r", name: "Liga-Abend", mode: "round-robin", created_at: "2026-10-12T16:00:00Z", bracket: [
      { id: "1", player1: "Anna", player2: "Ben", played: true, winner: "Ben" },
      { id: "2", player1: "Cara", player2: "Anna", played: false },
    ] };
    expect(manualTournamentResults([rr], new Set()).map((r) => r.winner)).toEqual(["Ben"]);
  });
});

describe("manualResultsFor", () => {
  const results = manualTournamentResults([ko([
    { id: "a", round: 1, position: 0, player1: "Martin", player2: "Moritz", winner: "Martin" },
    { id: "b", round: 1, position: 1, player1: "Anna & Ben", player2: "Cara & Dan", winner: "Cara & Dan" },
  ])], new Set());

  it("gives the opponent and the outcome from the player's side", () => {
    expect(manualResultsFor(results, "Martin")).toEqual([{ opponent: "Moritz", won: true, date: "2026-10-10T16:00:00Z" }]);
    expect(manualResultsFor(results, "Moritz")[0]).toMatchObject({ opponent: "Martin", won: false });
  });

  it("counts a doubles result for every member of the team", () => {
    expect(manualResultsFor(results, "Ben")[0]).toMatchObject({ opponent: "Cara & Dan", won: false });
    expect(manualResultsFor(results, "Dan")[0]).toMatchObject({ opponent: "Anna & Ben", won: true });
    expect(manualResultsFor(results, "Nobody")).toEqual([]);
  });
});

describe("resultFromLegs", () => {
  it("names whoever has more legs as the winner, whichever side that is", () => {
    expect(resultFromLegs("Anna", "Ben", "3", "1")).toEqual({ winner: "Anna", score1: 3, score2: 1 });
    expect(resultFromLegs("Anna", "Ben", "0", "2")).toEqual({ winner: "Ben", score1: 0, score2: 2 });
  });
  it("is null for a level score, an empty field or anything that is not a whole number", () => {
    expect(resultFromLegs("Anna", "Ben", "2", "2")).toBeNull();
    expect(resultFromLegs("Anna", "Ben", "", "2")).toBeNull();
    expect(resultFromLegs("Anna", "Ben", "1.5", "2")).toBeNull();
    expect(resultFromLegs("Anna", "Ben", "-1", "2")).toBeNull();
  });
});

describe("manualRecordFor", () => {
  const results = [
    { key: "t1:a", tournamentName: "Nov", date: "2026-11-13T18:00:00Z", player1: "Anna", player2: "Ben", winner: "Anna" },
    { key: "t1:b", tournamentName: "Nov", date: "2026-11-13T18:00:00Z", player1: "Ben", player2: "Anna", winner: "Ben" },
    { key: "t0:c", tournamentName: "Okt", date: "2025-10-10T18:00:00Z", player1: "Anna & Cara", player2: "Ben & Dirk", winner: "Anna & Cara" },
  ];
  it("counts played and won, doubles teams for each member", () => {
    expect(manualRecordFor(results, "Anna")).toEqual({ played: 3, won: 2 });
    expect(manualRecordFor(results, "Cara")).toEqual({ played: 1, won: 1 });
  });
  it("applies the date filter", () => {
    expect(manualRecordFor(results, "Anna", (d) => d.startsWith("2026"))).toEqual({ played: 2, won: 1 });
  });
});
