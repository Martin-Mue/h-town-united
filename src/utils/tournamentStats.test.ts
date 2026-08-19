import { describe, it, expect } from "vitest";
import { computeTournamentHighlights, type TournamentStatsLegRow } from "./tournamentStats";
import type { DartThrow } from "./dartStats";

const dart = (baseValue: number, multiplier: number, boardU?: number, boardV?: number): DartThrow => ({
  baseValue, multiplier, points: baseValue * multiplier, ...(boardU !== undefined ? { boardU, boardV } : {}),
});

describe("computeTournamentHighlights", () => {
  it("counts big triples (T16-T20) but not smaller ones", () => {
    const legs: TournamentStatsLegRow[] = [{
      player_id: "p1", player_name: "Martin", starting_score: 501, won: false,
      throws: [dart(20, 3), dart(19, 3), dart(5, 3), dart(20, 1)],
    }];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].bigTriples).toBe(2);
  });

  it("counts bull hits regardless of single/double", () => {
    const legs: TournamentStatsLegRow[] = [{
      player_id: "p1", player_name: "Martin", starting_score: 501, won: false,
      throws: [dart(25, 1), dart(25, 2), dart(20, 1)],
    }];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].bulls).toBe(2);
  });

  it("counts 180s via the shared count180s logic", () => {
    const legs: TournamentStatsLegRow[] = [{
      player_id: "p1", player_name: "Martin", starting_score: 501, won: false,
      throws: [dart(20, 3), dart(20, 3), dart(20, 3)],
    }];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].oneEighties).toBe(1);
  });

  it("only counts checkouts on a WON leg, and a 170 counts as both maximum and ton-plus", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 170, won: true, throws: [dart(20, 3), dart(20, 3), dart(25, 2)] },
      // Same shape but not actually won — must not count.
      { player_id: "p1", player_name: "Martin", starting_score: 170, won: false, throws: [dart(20, 3), dart(20, 3), dart(25, 2)] },
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].maxCheckouts).toBe(1);
    expect(participants[0].tonPlusFinishes).toBe(1);
  });

  it("counts a 120 checkout as ton-plus but not as a maximum", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 120, won: true, throws: [dart(20, 3), dart(20, 1), dart(20, 2)] },
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].tonPlusFinishes).toBe(1);
    expect(participants[0].maxCheckouts).toBe(0);
  });

  it("groups guests without a player_id by name instead of merging them together", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: null, player_name: "Gast Uwe", starting_score: 501, won: false, throws: [dart(20, 3), dart(20, 3), dart(20, 3)] },
      { player_id: null, player_name: "Gast Kevin", starting_score: 501, won: false, throws: [dart(20, 3), dart(20, 3), dart(20, 3)] },
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants).toHaveLength(2);
    expect(participants.map((p) => p.name).sort()).toEqual(["Gast Kevin", "Gast Uwe"]);
  });

  it("pools boardU/boardV points across every leg into the heatmap", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 501, won: false, throws: [dart(20, 3, 0.1, 0.2)] },
      { player_id: "p2", player_name: "Kevin", starting_score: 501, won: false, throws: [dart(1, 1), dart(19, 1, -0.3, 0.5)] },
    ];
    const { heatmapPoints } = computeTournamentHighlights(legs);
    // One dart has no boardU/boardV (manual entry) — must be skipped, not pushed as undefined.
    expect(heatmapPoints).toHaveLength(2);
  });

  it("excludes a participant with no highlight-worthy darts at all", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 501, won: false, throws: [dart(1, 1), dart(2, 1), dart(3, 1)] },
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants).toHaveLength(0);
  });

  it("sorts participants by 180s first", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "OneEighty", starting_score: 501, won: false, throws: [dart(20, 3), dart(20, 3), dart(20, 3)] },
      { player_id: "p2", player_name: "JustBull", starting_score: 501, won: false, throws: [dart(25, 1)] },
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].name).toBe("OneEighty");
  });
});
