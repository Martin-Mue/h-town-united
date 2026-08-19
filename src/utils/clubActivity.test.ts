import { describe, it, expect } from "vitest";
import { computeClubActivity, type ActivityGameRow, type ActivityLegRow } from "./clubActivity";
import type { DartThrow } from "./dartStats";

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

const dart = (points: number): DartThrow => ({ baseValue: points, multiplier: 1, points });
const dartsOf = (...points: number[]): DartThrow[] => points.map(dart);

const game = (over: Partial<ActivityGameRow> & { id: string; played_at: string }): ActivityGameRow => ({
  player1_id: "p1", player2_id: "p2", player1_name: "Martin", player2_name: "Kevin",
  player1_average: 50, player2_average: 45, winner_id: "p1",
  ...over,
});

describe("computeClubActivity", () => {
  it("reports a 180 within the recent window", () => {
    const legs: ActivityLegRow[] = [
      { game_id: "g1", player_id: "p1", player_name: "Martin", throws: dartsOf(60, 60, 60), starting_score: 501, won: false },
    ];
    const events = computeClubActivity([game({ id: "g1", played_at: daysAgo(1) })], legs);
    expect(events.some((e) => e.type === "180" && e.playerName === "Martin")).toBe(true);
  });

  it("does not report a 180 outside the recent window", () => {
    const legs: ActivityLegRow[] = [
      { game_id: "g1", player_id: "p1", player_name: "Martin", throws: dartsOf(60, 60, 60), starting_score: 501, won: false },
    ];
    const events = computeClubActivity([game({ id: "g1", played_at: daysAgo(30) })], legs, 14);
    expect(events.some((e) => e.type === "180")).toBe(false);
  });

  it("credits a 180 even for a guest with no linked player_id", () => {
    const legs: ActivityLegRow[] = [
      { game_id: "g1", player_id: null, player_name: "Gast Uwe", throws: dartsOf(60, 60, 60), starting_score: 501, won: false },
    ];
    const events = computeClubActivity([game({ id: "g1", played_at: daysAgo(1), player1_id: null, player1_name: "Gast Uwe" })], legs);
    expect(events.some((e) => e.type === "180" && e.playerName === "Gast Uwe")).toBe(true);
  });

  it("does NOT treat a player's first-ever recorded game as a personal best", () => {
    const g = game({ id: "g1", played_at: daysAgo(1), player1_average: 80 });
    const events = computeClubActivity([g], []);
    expect(events.some((e) => e.type === "pb_average")).toBe(false);
  });

  it("reports a new personal-best average once there's a real prior best to beat", () => {
    const games = [
      game({ id: "g1", played_at: daysAgo(40), player1_average: 40 }),
      game({ id: "g2", played_at: daysAgo(30), player1_average: 42 }),
      game({ id: "g3", played_at: daysAgo(20), player1_average: 44 }),
      game({ id: "g4", played_at: daysAgo(2), player1_average: 60 }), // clear new best, recent
    ];
    const events = computeClubActivity(games, [], 14);
    const pb = events.find((e) => e.type === "pb_average");
    expect(pb).toBeDefined();
    expect(pb!.detail).toContain("60.0");
  });

  it("does not re-report an average that's below an already-established best", () => {
    const games = [
      game({ id: "g1", played_at: daysAgo(40), player1_average: 70 }),
      game({ id: "g2", played_at: daysAgo(30), player1_average: 70 }),
      game({ id: "g3", played_at: daysAgo(20), player1_average: 70 }),
      game({ id: "g4", played_at: daysAgo(2), player1_average: 50 }), // worse, recent
    ];
    const events = computeClubActivity(games, [], 14);
    expect(events.some((e) => e.type === "pb_average")).toBe(false);
  });

  it("reports a win-streak milestone but not an in-between count", () => {
    const games = [
      game({ id: "g1", played_at: daysAgo(5), winner_id: "p1" }),
      game({ id: "g2", played_at: daysAgo(4), winner_id: "p1" }),
      game({ id: "g3", played_at: daysAgo(3), winner_id: "p1" }), // streak = 3, a milestone
      game({ id: "g4", played_at: daysAgo(2), winner_id: "p1" }), // streak = 4, NOT a milestone
    ];
    const events = computeClubActivity(games, [], 14);
    const streakEvents = events.filter((e) => e.type === "win_streak");
    expect(streakEvents).toHaveLength(1);
    expect(streakEvents[0].detail).toContain("3 Siege");
  });

  it("resets the streak on a loss", () => {
    const games = [
      game({ id: "g1", played_at: daysAgo(6), winner_id: "p1" }),
      game({ id: "g2", played_at: daysAgo(5), winner_id: "p1" }),
      game({ id: "g3", played_at: daysAgo(4), winner_id: "p2" }), // p1 loses, streak resets
      game({ id: "g4", played_at: daysAgo(3), winner_id: "p1" }),
      game({ id: "g5", played_at: daysAgo(2), winner_id: "p1" }),
      game({ id: "g6", played_at: daysAgo(1), winner_id: "p1" }), // only streak=3 here, not 5
    ];
    const events = computeClubActivity(games, [], 14);
    const streakEvents = events.filter((e) => e.type === "win_streak" && e.playerName === "Martin");
    expect(streakEvents).toHaveLength(1);
    expect(streakEvents[0].detail).toContain("3 Siege");
  });

  it("reports a new best checkout only once there's a prior one to beat", () => {
    const legs: ActivityLegRow[] = [
      { game_id: "g1", player_id: "p1", player_name: "Martin", throws: dartsOf(60, 60, 40), starting_score: 160, won: true }, // checkout 160? not realistic but fine for the arithmetic test
      { game_id: "g2", player_id: "p1", player_name: "Martin", throws: dartsOf(20, 20, 40), starting_score: 80, won: true },
    ];
    const games = [
      game({ id: "g1", played_at: daysAgo(10) }),
      game({ id: "g2", played_at: daysAgo(2) }),
    ];
    const events = computeClubActivity(games, legs, 14);
    // Second checkout (80) is lower than the first (160) — should NOT be reported as a new best.
    expect(events.some((e) => e.type === "pb_checkout")).toBe(false);
  });
});
