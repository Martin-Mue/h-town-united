import { describe, it, expect } from "vitest";
import { computeClutchStats, describeClutchTakeaway, type ClutchGameRow, type ClutchLegRow } from "./clutchStats";
import type { DartThrow, CheckoutStats } from "./dartStats";

const co = (over: Partial<CheckoutStats>): CheckoutStats => ({ attempts: 0, hits: 0, percentage: 0, highestCheckout: 0, ...over });

const dart = (points: number): DartThrow => ({ baseValue: points, multiplier: 1, points });
const dartsOf = (...points: number[]): DartThrow[] => points.map(dart);

describe("computeClutchStats", () => {
  it("does not count the opening leg of a best-of-3 as clutch", () => {
    const games: ClutchGameRow[] = [{ id: "g1", best_of_legs: 3 }];
    const legs: ClutchLegRow[] = [
      { game_id: "g1", leg_number: 1, player_index: 0, player_id: "p1", starting_score: 40, throws: dartsOf(40), won: true },
      { game_id: "g1", leg_number: 1, player_index: 1, player_id: "p2", starting_score: 40, throws: [], won: false },
    ];
    const result = computeClutchStats(games, legs, "p1");
    expect(result.clutch.attempts).toBe(0);
    expect(result.normal.attempts).toBe(1);
  });

  it("counts a leg as clutch once either side is one leg from winning the match", () => {
    const games: ClutchGameRow[] = [{ id: "g1", best_of_legs: 3 }];
    const legs: ClutchLegRow[] = [
      { game_id: "g1", leg_number: 1, player_index: 0, player_id: "p1", starting_score: 40, throws: dartsOf(40), won: true },
      { game_id: "g1", leg_number: 1, player_index: 1, player_id: "p2", starting_score: 40, throws: [], won: false },
      // p1 now has 1/2 legs won going into leg 2 — leg 2 is match point for p1.
      { game_id: "g1", leg_number: 2, player_index: 0, player_id: "p1", starting_score: 40, throws: dartsOf(40), won: true },
      { game_id: "g1", leg_number: 2, player_index: 1, player_id: "p2", starting_score: 40, throws: [], won: false },
    ];
    const result = computeClutchStats(games, legs, "p1");
    expect(result.clutch.attempts).toBe(1);
    expect(result.clutch.hits).toBe(1);
    expect(result.normal.attempts).toBe(1);
  });

  it("treats every leg of a best-of-1 as clutch from the start", () => {
    const games: ClutchGameRow[] = [{ id: "g1", best_of_legs: 1 }];
    const legs: ClutchLegRow[] = [
      { game_id: "g1", leg_number: 1, player_index: 0, player_id: "p1", starting_score: 40, throws: dartsOf(40), won: true },
      { game_id: "g1", leg_number: 1, player_index: 1, player_id: "p2", starting_score: 40, throws: [], won: false },
    ];
    const result = computeClutchStats(games, legs, "p1");
    expect(result.clutch.attempts).toBe(1);
    expect(result.normal.attempts).toBe(0);
  });

  it("ignores team/multiplayer games (more than 2 distinct player slots)", () => {
    const games: ClutchGameRow[] = [{ id: "g1", best_of_legs: 3 }];
    const legs: ClutchLegRow[] = [
      { game_id: "g1", leg_number: 1, player_index: 0, player_id: "p1", starting_score: 40, throws: dartsOf(40), won: true },
      { game_id: "g1", leg_number: 1, player_index: 1, player_id: "p2", starting_score: 40, throws: [], won: false },
      { game_id: "g1", leg_number: 1, player_index: 2, player_id: "p3", starting_score: 40, throws: [], won: false },
    ];
    const result = computeClutchStats(games, legs, "p1");
    expect(result.clutch.attempts).toBe(0);
    expect(result.normal.attempts).toBe(0);
  });

  it("only pools attempts for the requested player", () => {
    const games: ClutchGameRow[] = [{ id: "g1", best_of_legs: 1 }];
    const legs: ClutchLegRow[] = [
      { game_id: "g1", leg_number: 1, player_index: 0, player_id: "p1", starting_score: 40, throws: dartsOf(40), won: true },
      { game_id: "g1", leg_number: 1, player_index: 1, player_id: "p2", starting_score: 40, throws: dartsOf(20), won: false },
    ];
    const result = computeClutchStats(games, legs, "p2");
    expect(result.clutch.attempts).toBe(1);
    expect(result.clutch.hits).toBe(0);
  });

  it("ignores a game whose best_of_legs can't be found", () => {
    const legs: ClutchLegRow[] = [
      { game_id: "ghost", leg_number: 1, player_index: 0, player_id: "p1", starting_score: 40, throws: dartsOf(40), won: true },
      { game_id: "ghost", leg_number: 1, player_index: 1, player_id: "p2", starting_score: 40, throws: [], won: false },
    ];
    const result = computeClutchStats([], legs, "p1");
    expect(result.clutch.attempts).toBe(0);
    expect(result.normal.attempts).toBe(0);
  });
});

describe("describeClutchTakeaway", () => {
  it("reports a positive clutch factor when the pressure rate is clearly higher", () => {
    const text = describeClutchTakeaway({ clutch: co({ percentage: 70 }), normal: co({ percentage: 50 }) });
    expect(text).toContain("häufiger");
  });

  it("reports a drop when the pressure rate is clearly lower", () => {
    const text = describeClutchTakeaway({ clutch: co({ percentage: 30 }), normal: co({ percentage: 50 }) });
    expect(text).toContain("sinkt");
  });

  it("reports no measurable difference for a small gap", () => {
    const text = describeClutchTakeaway({ clutch: co({ percentage: 52 }), normal: co({ percentage: 50 }) });
    expect(text).toContain("Kein messbarer Unterschied");
  });
});
