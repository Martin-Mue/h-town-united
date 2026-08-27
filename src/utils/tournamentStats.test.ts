import { describe, it, expect } from "vitest";
import {
  computeTournamentHighlights, computeTournamentAverages, mergeTournamentStats, sortParticipants,
  computeLegAveragesByGame, type TournamentStatsLegRow, type TournamentStatsGameRow,
} from "./tournamentStats";
import type { DartThrow } from "./dartStats";

const dart = (baseValue: number, multiplier: number, boardU?: number, boardV?: number): DartThrow => ({
  baseValue, multiplier, points: baseValue * multiplier, ...(boardU !== undefined ? { boardU, boardV } : {}),
});

describe("computeTournamentHighlights", () => {
  it("counts big triples (T15-T20) but not smaller ones", () => {
    const legs: TournamentStatsLegRow[] = [{
      player_id: "p1", player_name: "Martin", starting_score: 501, won: false,
      throws: [dart(20, 3), dart(19, 3), dart(15, 3), dart(14, 3), dart(5, 3), dart(20, 1)],
    }];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].bigTriples).toBe(3);
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

  it("only counts a highestCheckout on a WON leg", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 170, won: true, throws: [dart(20, 3), dart(20, 3), dart(25, 2)] },
      // Same shape but not actually won — must not count.
      { player_id: "p1", player_name: "Martin", starting_score: 170, won: false, throws: [dart(20, 3), dart(20, 3), dart(25, 2)] },
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].highestCheckout).toBe(170);
  });

  it("tracks each participant's own highest checkout across multiple won legs, not just the latest", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 120, won: true, throws: [dart(20, 3), dart(20, 1), dart(20, 2)] }, // 120 checkout
      { player_id: "p1", player_name: "Martin", starting_score: 40, won: true, throws: [dart(20, 2)] }, // 40 checkout — smaller, must not overwrite
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].highestCheckout).toBe(120);
  });

  it("tracks each participant's own fewest darts to checkout, ignoring lost legs", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 501, won: true, throws: [dart(20, 3), dart(20, 3), dart(20, 3), dart(20, 3), dart(20, 3), dart(1, 1)] }, // 6 darts
      { player_id: "p1", player_name: "Martin", starting_score: 40, won: true, throws: [dart(20, 2)] }, // 1 dart — new personal best
      { player_id: "p1", player_name: "Martin", starting_score: 40, won: false, throws: [dart(20, 1)] }, // lost, must not count as a 1-darter
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].shortestLeg).toBe(1);
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

  it("tracks the tournament's top checkout, only counting won legs", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 170, won: true, throws: [dart(20, 3), dart(20, 3), dart(25, 2)] },
      { player_id: "p2", player_name: "Kevin", starting_score: 40, won: true, throws: [dart(20, 2)] },
      // Same 170 shape as Martin's but lost — must not become the new top checkout.
      { player_id: "p3", player_name: "NotAWin", starting_score: 170, won: false, throws: [dart(20, 3), dart(20, 3), dart(25, 2)] },
    ];
    const { topCheckout } = computeTournamentHighlights(legs);
    expect(topCheckout).toEqual({ name: "Martin", value: 170 });
  });

  it("tracks the tournament's shortest won leg by dart count", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 170, won: true, throws: [dart(20, 3), dart(20, 3), dart(25, 2)] },
      {
        player_id: "p2", player_name: "Kevin", starting_score: 501, won: true,
        throws: [dart(20, 3), dart(20, 3), dart(20, 3), dart(20, 3), dart(20, 3), dart(1, 1)],
      },
      // Fewer darts than Martin's leg, but LOST — must not become the new shortest leg.
      { player_id: "p3", player_name: "TooFast", starting_score: 40, won: false, throws: [dart(20, 2)] },
    ];
    const { shortestLeg } = computeTournamentHighlights(legs);
    expect(shortestLeg).toEqual({ name: "Martin", darts: 3 });
  });

  it("counts 100+/140+ scoring visits on any leg, won or not — unlike highestCheckout", () => {
    const legs: TournamentStatsLegRow[] = [
      // Lost this leg, but still threw a 140 visit along the way.
      { player_id: "p1", player_name: "Martin", starting_score: 501, won: false, throws: [dart(20, 3), dart(20, 3), dart(20, 1)] },
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].oneHundredPlus).toBe(1);
    expect(participants[0].oneFortyPlus).toBe(1);
    expect(participants[0].highestCheckout).toBe(0);
  });

  it("counts a 100-119 visit toward oneHundredPlus but not oneTwentyPlus/oneFortyPlus", () => {
    // 40 + 40 + 20 = 100 — a ton, but no triple/bull/180/won-checkout in sight.
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 501, won: false, throws: [dart(20, 2), dart(20, 2), dart(20, 1)] },
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants).toHaveLength(1);
    expect(participants[0].oneHundredPlus).toBe(1);
    expect(participants[0].oneTwentyPlus).toBe(0);
    expect(participants[0].oneFortyPlus).toBe(0);
  });

  it("counts a 120-139 visit toward oneTwentyPlus but not oneFortyPlus", () => {
    // 60 + 40 + 20 = 120
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 501, won: false, throws: [dart(20, 3), dart(20, 2), dart(20, 1)] },
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].oneTwentyPlus).toBe(1);
    expect(participants[0].oneFortyPlus).toBe(0);
  });

  it("counts a 160+ visit toward every lower tier too", () => {
    // 60 + 60 + 40 = 160
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 501, won: false, throws: [dart(20, 3), dart(20, 3), dart(20, 2)] },
    ];
    const { participants } = computeTournamentHighlights(legs);
    expect(participants[0].oneSixtyPlus).toBe(1);
    expect(participants[0].oneFortyPlus).toBe(1);
    expect(participants[0].oneTwentyPlus).toBe(1);
    expect(participants[0].oneHundredPlus).toBe(1);
  });

  it("leaves topCheckout and shortestLeg null when nobody has won a leg yet", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 501, won: false, throws: [dart(20, 3), dart(20, 3), dart(20, 3)] },
    ];
    const { topCheckout, shortestLeg } = computeTournamentHighlights(legs);
    expect(topCheckout).toBeNull();
    expect(shortestLeg).toBeNull();
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
    expect(merged[0].gamesPlayed).toBe(0);
  });

  it("carries gamesPlayed through from the averages side", () => {
    const highlights = computeTournamentHighlights([]);
    const averages = computeTournamentAverages([game({ id: "g1" }), game({ id: "g2" })]);
    const merged = mergeTournamentStats(highlights, averages);
    expect(merged.find((p) => p.key === "p1")!.gamesPlayed).toBe(2);
  });
});

describe("computeLegAveragesByGame", () => {
  const games: TournamentStatsGameRow[] = [game({ id: "g1" })];

  it("pairs legs by leg_number and resolves side against the matching game row", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 501, won: true, game_id: "g1", leg_number: 1, throws: [dart(20, 3), dart(20, 3), dart(20, 3)] }, // 180 avg
      { player_id: "p2", player_name: "Kevin", starting_score: 501, won: false, game_id: "g1", leg_number: 1, throws: [dart(1, 1), dart(1, 1), dart(1, 1)] }, // 3 avg
      { player_id: "p1", player_name: "Martin", starting_score: 501, won: false, game_id: "g1", leg_number: 2, throws: [dart(20, 1)] }, // 60 avg
      { player_id: "p2", player_name: "Kevin", starting_score: 501, won: true, game_id: "g1", leg_number: 2, throws: [dart(20, 2)] }, // 120 avg
    ];
    const byGame = computeLegAveragesByGame(legs, games);
    const legAverages = byGame.get("g1")!;
    expect(legAverages).toHaveLength(2);
    expect(legAverages[0]).toEqual({ player1Average: 180, player2Average: 3, player1Darts: 3, player2Darts: 3, winner: 1 });
    expect(legAverages[1]).toEqual({ player1Average: 60, player2Average: 120, player1Darts: 1, player2Darts: 1, winner: 2 });
  });

  it("skips legs with no throws recorded or missing game_id/leg_number", () => {
    const legs: TournamentStatsLegRow[] = [
      { player_id: "p1", player_name: "Martin", starting_score: 501, won: false, throws: [] },
      { player_id: "p2", player_name: "Kevin", starting_score: 501, won: false, throws: [dart(20, 1)] }, // no game_id/leg_number
    ];
    const byGame = computeLegAveragesByGame(legs, games);
    expect(byGame.size).toBe(0);
  });
});

describe("sortParticipants", () => {
  const players = ["Martin", "kevin", "Zoe", "Abdul"];

  it("sorts alphabetically, case-insensitively, regardless of averages passed in", () => {
    expect(sortParticipants(players, "alpha", null)).toEqual(["Abdul", "kevin", "Martin", "Zoe"]);
  });

  it("ranks by average descending in \"average\" mode", () => {
    const averages = computeTournamentAverages([
      { id: "g1", player1_id: "p1", player1_name: "Martin", player1_average: 45, player2_id: "p2", player2_name: "kevin", player2_average: 60 },
    ]);
    expect(sortParticipants(["Martin", "kevin"], "average", averages)).toEqual(["kevin", "Martin"]);
  });

  it("sorts players with no average yet to the end, alphabetically among themselves", () => {
    const averages = computeTournamentAverages([
      { id: "g1", player1_id: "p1", player1_name: "Zoe", player1_average: 50, player2_id: "p2", player2_name: "Abdul", player2_average: 0 },
    ]);
    // Martin and kevin never appear in a game row at all — same "no average yet" bucket as
    // Abdul, who has a game row but a 0 average (e.g. hasn't actually thrown yet).
    expect(sortParticipants(players, "average", averages)).toEqual(["Zoe", "Abdul", "kevin", "Martin"]);
  });

  it("falls back to alphabetical-only behavior when there's no averages data at all yet", () => {
    expect(sortParticipants(players, "average", null)).toEqual(["Abdul", "kevin", "Martin", "Zoe"]);
  });
});
