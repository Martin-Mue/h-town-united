import { describe, expect, it } from "vitest";
import { manualResultsFor, manualTournamentResults, type TournamentForStats } from "./tournamentResults";

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
