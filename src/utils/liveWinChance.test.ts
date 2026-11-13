import { describe, it, expect } from "vitest";
import { legWinChance, liveWinChance, matchWinChance, steadiedAverage } from "./liveWinChance";
import { createLegState } from "./gameStateFactory";
import type { DartThrow, GameState, PlayerSlot } from "@/types/game";

const players: PlayerSlot[] = [{ name: "A", doubleOut: true, isBot: false }, { name: "B", doubleOut: true, isBot: false }];
const t20: DartThrow = { baseValue: 20, multiplier: 3, points: 60 };
const s5: DartThrow = { baseValue: 5, multiplier: 1, points: 5 };

function match(bestOfLegs: number, throwsA: DartThrow[], throwsB: DartThrow[], legsWon: [number, number] = [0, 0]): GameState {
  const leg = createLegState(1, 501, 0, players);
  leg.throws = [throwsA, throwsB];
  leg.remaining = [501 - throwsA.reduce((s, d) => s + d.points, 0), 501 - throwsB.reduce((s, d) => s + d.points, 0)];
  return { mode: "501", startScore: 501, bestOfLegs, players, legsWon, currentLeg: leg, completedLegs: [], currentPlayerIndex: 0, isFinished: false };
}

describe("steadiedAverage", () => {
  it("starts at the typical average and moves to the real one with more darts", () => {
    expect(steadiedAverage(0, 0)).toBeCloseTo(45);
    expect(steadiedAverage(180, 3)).toBeGreaterThan(45);
    expect(steadiedAverage(6000, 300)).toBeGreaterThan(58);
    expect(steadiedAverage(6000, 300)).toBeLessThan(60);
  });
});

describe("legWinChance", () => {
  it("is even for an even race apart from the throw, and favours the side that is ahead", () => {
    expect(legWinChance(5, 5, true)).toBeGreaterThan(0.5);
    expect(legWinChance(5, 5, true) + legWinChance(5, 5, false)).toBeCloseTo(1);
    expect(legWinChance(2, 6, false)).toBeGreaterThan(0.9);
  });
});

describe("matchWinChance", () => {
  it("is the leg chance in a single-leg match", () => {
    expect(matchWinChance(0, 0, 1, 0.7, 0.5, 0.5, true)).toBeCloseTo(0.7);
  });
  it("grows with legs already won", () => {
    const level = matchWinChance(0, 0, 3, 0.5, 0.5, 0.5, true);
    const ahead = matchWinChance(2, 0, 3, 0.5, 0.5, 0.5, true);
    expect(level).toBeCloseTo(0.5);
    expect(ahead).toBeGreaterThan(0.8);
  });
});

describe("liveWinChance", () => {
  it("says nothing before the first dart, for Cricket, teams, sets or more than two players", () => {
    expect(liveWinChance(match(3, [], []))).toBeNull();
    expect(liveWinChance({ ...match(3, [t20], []), mode: "cricket" })).toBeNull();
    expect(liveWinChance({ ...match(3, [t20], []), setsMode: { bestOfSets: 3 } })).toBeNull();
    expect(liveWinChance({ ...match(3, [t20], []), isFinished: true })).toBeNull();
  });

  it("favours the player who scores more and is further ahead", () => {
    const chance = liveWinChance(match(3, [t20, t20, t20, t20, t20, t20], [s5, s5, s5, s5, s5, s5]))!;
    expect(chance).toBeGreaterThan(0.85);
    expect(chance).toBeLessThan(1);
  });

  it("stays between 0 and 1 and mirrors when the players are swapped", () => {
    const a = liveWinChance(match(5, [t20, t20, s5], [s5, t20, s5], [1, 2]))!;
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });
});
