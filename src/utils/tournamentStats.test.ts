import { describe, it, expect } from "vitest";
import {
  computeTournamentHighlights, computeTournamentAverages, mergeTournamentStats,
  type TournamentStatsLegRow, type TournamentStatsGameRow,
} from "./tournamentStats";
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

  it("only counts checkouts on a WON leg, and a 170 counts toward every tier", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 170, won: true, throws: [dart(20, 3), dart(20, 3), dart(25, 2)] },
      // Same shape but not actually won — must not count.
      { player_id: "p1", player_name: "Martin", starting_score: 170, won: false, throws: [dart(20, 3), dart(20, 3), dart(25, 2)] },
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].checkout170).toBe(1);
    expect(participants[0].checkout160Plus).toBe(1);
    expect(participants[0].checkout140Plus).toBe(1);
    expect(participants[0].checkout120Plus).toBe(1);
    expect(participants[0].checkout100Plus).toBe(1);
  });

  it("counts a 120 checkout toward 100+/120+ but not 140+/160+/170", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 120, won: true, throws: [dart(20, 3), dart(20, 1), dart(20, 2)] },
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].checkout100Plus).toBe(1);
    expect(participants[0].checkout120Plus).toBe(1);
    expect(participants[0].checkout140Plus).toBe(0);
    expect(participants[0].checkout160Plus).toBe(0);
    expect(participants[0].checkout170).toBe(0);
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

const game = (over: Partial<TournamentStatsGameRow> & { id: string }): TournamentStatsGameRow => ({
  player1_id: "p1", player1_name: "Martin", player1_average: 45,
  player2_id: "p2", player2_name: "Kevin", player2_average: 38,
  ...over,
});

describe("computeTournamentAverages", () => {
  it("pools a participant's own game averages as a mean, not a weighted total", () => {
    const games: TournamentStatsGameRow[] = [
      game({ id: "g1", player1_average: 40 }),
      game({ id: "g2", player1_average: 60 }),
    ];
    const { participants } = computeTournamentAverages(games);
    const martin = participants.find((p) => p.key === "p1")!;
    expect(martin.tournamentAverage).toBe(50);
    expect(martin.gamesPlayed).toBe(2);
  });

  it("needs no per-dart data at all — works purely off games rows (hand-scored tournament)", () => {
    const games: TournamentStatsGameRow[] = [game({ id: "g1" })];
    const { participants } = computeTournamentAverages(games);
    expect(participants).toHaveLength(2);
  });

  it("passes through the per-game breakdown unaggregated", () => {
    const games: TournamentStatsGameRow[] = [game({ id: "g1" }), game({ id: "g2", player1_average: 55 })];
    const { games: rows } = computeTournamentAverages(games);
    expect(rows).toHaveLength(2);
    expect(rows[1].player1Average).toBe(55);
  });

  it("groups guests without a player_id by name", () => {
    const games: TournamentStatsGameRow[] = [
      game({ id: "g1", player1_id: null, player1_name: "Gast Uwe" }),
    ];
    const { participants } = computeTournamentAverages(games);
    expect(participants.some((p) => p.key === "Gast Uwe")).toBe(true);
  });

  it("sorts by tournament average descending", () => {
    const games: TournamentStatsGameRow[] = [game({ id: "g1", player1_average: 30, player2_average: 70 })];
    const { participants } = computeTournamentAverages(games);
    expect(participants[0].key).toBe("p2");
  });
});

describe("mergeTournamentStats", () => {
  it("gives a full row (zeroed highlight fields) to someone with an average but no highlight-worthy darts", () => {
    const highlights = computeTournamentHighlights([]);
    const averages = computeTournamentAverages([game({ id: "g1" })]);
    const merged = mergeTournamentStats(highlights, averages);
    expect(merged).toHaveLength(2);
    expect(merged.find((p) => p.key === "p1")!.oneEighties).toBe(0);
    expect(merged.find((p) => p.key === "p1")!.tournamentAverage).toBe(45);
  });

  it("gives a full row (zeroed average) to someone with highlights but no game-average data", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p3", player_name: "NoGameRow", starting_score: 501, won: false, throws: [dart(20, 3), dart(20, 3), dart(20, 3)] },
    ];
    const highlights = computeTournamentHighlights(legs);
    const averages = computeTournamentAverages([]);
    const merged = mergeTournamentStats(highlights, averages);
    expect(merged).toHaveLength(1);
    expect(merged[0].tournamentAverage).toBe(0);
    expect(merged[0].oneEighties).toBe(1);
  });
});
