import { describe, it, expect } from "vitest";
import type { Match, RoundRobinMatch } from "./tournament";
import {
  buildModeStatsIndex,
  buildPlayerStatsIndex,
  forecastTournament,
  formatDuration,
  formatEta,
  type ForecastTournament,
  type ModeStatsRow,
  type PlayerModeStatsRow,
} from "./tournamentForecast";

const MODE_ROWS: ModeStatsRow[] = [
  { mode: "501", best_of_legs: 3, avg_legs_per_match: 2.4, match_count: 45, avg_darts_per_leg: 30, leg_count: 310 },
  { mode: "501", best_of_legs: 5, avg_legs_per_match: 3.6, match_count: 10, avg_darts_per_leg: 30, leg_count: 60 },
  { mode: "301", best_of_legs: 3, avg_legs_per_match: 2.3, match_count: 3, avg_darts_per_leg: 17, leg_count: 24 },
];
const modeStats = buildModeStatsIndex(MODE_ROWS);
const emptyModeStats = buildModeStatsIndex([]);

const PLAYER_ROWS: PlayerModeStatsRow[] = [
  { player_name: "Fast Freddy", mode: "501", avg_darts_per_leg: 18, leg_count: 20 },
  { player_name: "Slow Sam", mode: "501", avg_darts_per_leg: 45, leg_count: 20 },
  { player_name: "Newbie", mode: "501", avg_darts_per_leg: 9, leg_count: 2 }, // below MIN_PLAYER_SAMPLE
];
const playerStats = buildPlayerStatsIndex(PLAYER_ROWS);
const emptyPlayerStats = buildPlayerStatsIndex([]);

function koTournament(overrides: Partial<ForecastTournament> = {}): ForecastTournament {
  return {
    id: "t1",
    name: "Test Cup",
    mode: "ko",
    players: ["A", "B", "C", "D"],
    bracket: [
      { id: "r1-0", round: 1, position: 0, player1: "A", player2: "B" },
      { id: "r1-1", round: 1, position: 1, player1: "C", player2: "D" },
      { id: "r2-0", round: 2, position: 0 },
    ] as Match[],
    game_mode: "501",
    best_of_legs: 3,
    boards: 2,
    ...overrides,
  };
}

describe("forecastTournament (KO)", () => {
  it("estimates a round from real legs-per-match × darts-per-leg × secondsPerDart", () => {
    const f = forecastTournament(koTournament(), 10, modeStats, emptyPlayerStats);
    const round1 = f.rounds.find((r) => r.round === 1)!;
    // Two round-1 matches, both no player history → mode-global darts/leg (30) × legs/match (2.4) × 10s.
    // 2 matches over 2 boards = 1 wave, so the round duration is just the (equal) per-match duration.
    expect(round1.estimatedSeconds).toBeCloseTo(2.4 * 30 * 10, 5);
    expect(round1.waves).toBe(1);
  });

  it("chunks a round into multiple sequential waves once matches exceed the board count", () => {
    const t = koTournament({
      boards: 1,
      bracket: [
        { id: "r1-0", round: 1, position: 0, player1: "A", player2: "B" },
        { id: "r1-1", round: 1, position: 1, player1: "C", player2: "D" },
        { id: "r2-0", round: 2, position: 0 },
      ] as Match[],
    });
    const f = forecastTournament(t, 10, modeStats, emptyPlayerStats);
    const round1 = f.rounds.find((r) => r.round === 1)!;
    expect(round1.waves).toBe(2); // 2 matches, 1 board → 2 sequential waves
    expect(round1.estimatedSeconds).toBeCloseTo(2 * (2.4 * 30 * 10), 5);
  });

  it("still estimates a future, not-yet-playable round from its known bracket size", () => {
    const f = forecastTournament(koTournament(), 10, modeStats, emptyPlayerStats);
    const round2 = f.rounds.find((r) => r.round === 2)!;
    expect(round2.matchCount).toBe(1); // final's single slot, players unknown yet
    expect(round2.estimatedSeconds).toBeCloseTo(2.4 * 30 * 10, 5);
  });

  it("resolves a different mode/bestOf per round via round_configs, including the preliminary round's past-the-end index", () => {
    const bracket: Match[] = [
      { id: "r0-0", round: 0, position: 0, player1: "A", player2: "B", feedsRound1Position: 0, feedsRound1Slot: 1 },
      { id: "r1-0", round: 1, position: 0 },
      { id: "r1-1", round: 1, position: 1, player1: "C", player2: "D" },
      { id: "r2-0", round: 2, position: 0 },
    ];
    // round_configs[0] = round 1's override, [1] = round 2's, [totalRounds=2] = round 0's (prelim).
    const t = koTournament({
      bracket,
      round_configs: [
        { mode: "301", bestOf: 3 },
        { mode: "501", bestOf: 5 },
        { mode: "Cricket", bestOf: 3 },
      ],
    });
    const f = forecastTournament(t, 10, modeStats, emptyPlayerStats);
    expect(f.rounds.find((r) => r.round === 0)!.mode).toBe("Cricket");
    expect(f.rounds.find((r) => r.round === 1)!.mode).toBe("301");
    expect(f.rounds.find((r) => r.round === 2)!.mode).toBe("501");
    // round 2 pulls best-of-5's own legs-per-match average (from MODE_ROWS: 3.6) rather than round 1's best-of-3 one.
    expect(f.rounds.find((r) => r.round === 2)!.estimatedSeconds).toBeCloseTo(3.6 * 30 * 10, 5);
  });

  it("marks an Extern round as unestimatable and nulls the tournament total", () => {
    const t = koTournament({ round_configs: [{ mode: "Extern", bestOf: 3 }] });
    const f = forecastTournament(t, 10, modeStats, emptyPlayerStats);
    const round1 = f.rounds.find((r) => r.round === 1)!;
    expect(round1.estimatedSeconds).toBeNull();
    expect(f.hasExternGap).toBe(true);
    expect(f.totalEstimatedSeconds).toBeNull();
    // A later, non-Extern round still gets its own real estimate even though the total is gapped.
    expect(f.rounds.find((r) => r.round === 2)!.estimatedSeconds).not.toBeNull();
  });

  it("falls back to a hardcoded guess for a mode/format the club has never actually played", () => {
    const t = koTournament({ game_mode: "cricket", round_configs: [] });
    const f = forecastTournament(t, 10, emptyModeStats, emptyPlayerStats);
    const round1 = f.rounds.find((r) => r.round === 1)!;
    // fallbackLegsPerMatch(3) = round((2+3)/2) = 3 (no wait: ceil(3/2)=2, (2+3)/2=2.5 → round=3); darts fallback for cricket = 15.
    expect(round1.estimatedSeconds).toBeCloseTo(3 * 15 * 10, 5);
  });

  it("uses a known player's own average when they have enough sampled legs, ignoring one with too few", () => {
    const t = koTournament({
      bracket: [
        { id: "r1-0", round: 1, position: 0, player1: "Fast Freddy", player2: "Newbie" },
        { id: "r2-0", round: 2, position: 0 },
      ] as Match[],
    });
    const f = forecastTournament(t, 10, modeStats, playerStats);
    const round1 = f.rounds.find((r) => r.round === 1)!;
    // Only Fast Freddy (20 legs) clears MIN_PLAYER_SAMPLE; Newbie (2 legs) is ignored, not averaged in.
    expect(round1.estimatedSeconds).toBeCloseTo(2.4 * 18 * 10, 5);
  });

  it("shortens a live match's remaining legs instead of using the full match average", () => {
    const t = koTournament({
      bracket: [
        {
          id: "r1-0", round: 1, position: 0, player1: "A", player2: "B",
          live: { legs1: 1, legs2: 0, updatedAt: new Date().toISOString() },
        },
        { id: "r1-1", round: 1, position: 1, player1: "C", player2: "D" },
        { id: "r2-0", round: 2, position: 0 },
      ] as Match[],
    });
    const f = forecastTournament(t, 10, modeStats, emptyPlayerStats);
    const round1 = f.rounds.find((r) => r.round === 1)!;
    // best-of-3 needs 2 legs to win; r1-0 already has 1 → 1 remaining leg instead of the 2.4 average.
    // r1-1 has no live snapshot → full 2.4-leg average. Two boards → both play concurrently (1 wave),
    // so the round's duration is the MEAN of the two (not shortened for both).
    const expectedMean = ((1 * 30 * 10) + (2.4 * 30 * 10)) / 2;
    expect(round1.estimatedSeconds).toBeCloseTo(expectedMean, 5);
  });
});

describe("forecastTournament (round-robin)", () => {
  function rrTournament(overrides: Partial<ForecastTournament> = {}): ForecastTournament {
    return {
      id: "rr1", name: "RR Cup", mode: "round-robin", players: ["A", "B", "C"],
      bracket: [
        { id: "m0", player1: "A", player2: "B", played: false },
        { id: "m1", player1: "A", player2: "C", played: false },
        { id: "m2", player1: "B", player2: "C", played: false },
      ] as RoundRobinMatch[],
      game_mode: "501", best_of_legs: 3, boards: 2,
      ...overrides,
    };
  }

  it("chunks remaining matches into synthetic waves of `boards` size, in array order", () => {
    const f = forecastTournament(rrTournament(), 10, modeStats, emptyPlayerStats);
    expect(f.rounds).toHaveLength(2); // 3 matches / 2 boards → waves of [2, 1]
    expect(f.rounds[0].matchCount).toBe(2);
    expect(f.rounds[1].matchCount).toBe(1);
    // Wave 1's 2 matches play concurrently (2 boards) so that wave counts once, not twice —
    // total = 2 waves × one match's duration, not 3 matches' durations summed.
    expect(f.totalEstimatedSeconds).toBeCloseTo(2 * (2.4 * 30 * 10), 5);
  });

  it("excludes already-played matches from the wave chunking", () => {
    const t = rrTournament({
      bracket: [
        { id: "m0", player1: "A", player2: "B", played: true, winner: "A" },
        { id: "m1", player1: "A", player2: "C", played: false },
        { id: "m2", player1: "B", player2: "C", played: false },
      ] as RoundRobinMatch[],
    });
    const f = forecastTournament(t, 10, modeStats, emptyPlayerStats);
    expect(f.rounds).toHaveLength(1);
    expect(f.rounds[0].matchCount).toBe(2);
  });

  it("returns a zero-round, zero-second forecast once every match is played", () => {
    const t = rrTournament({
      bracket: [
        { id: "m0", player1: "A", player2: "B", played: true, winner: "A" },
        { id: "m1", player1: "A", player2: "C", played: true, winner: "A" },
        { id: "m2", player1: "B", player2: "C", played: true, winner: "B" },
      ] as RoundRobinMatch[],
    });
    const f = forecastTournament(t, 10, modeStats, emptyPlayerStats);
    expect(f.rounds).toHaveLength(0);
    expect(f.totalEstimatedSeconds).toBe(0);
  });

  it("has no per-round mode override (round_configs is a KO-only concept) — always the tournament-wide mode", () => {
    const t = rrTournament({ game_mode: "Extern" });
    const f = forecastTournament(t, 10, modeStats, emptyPlayerStats);
    expect(f.hasExternGap).toBe(true);
    expect(f.totalEstimatedSeconds).toBeNull();
  });
});

describe("formatDuration / formatEta", () => {
  it("formats minutes-only and hours+minutes durations", () => {
    expect(formatDuration(90)).toBe("2 Min"); // rounds up from 1.5
    expect(formatDuration(45 * 60)).toBe("45 Min");
    expect(formatDuration(90 * 60)).toBe("1 Std 30 Min");
    expect(formatDuration(120 * 60)).toBe("2 Std");
  });

  it("formats an ETA as an HH:MM clock time", () => {
    expect(formatEta(3600)).toMatch(/^\d{2}:\d{2}$/);
  });
});
