import { describe, it, expect } from "vitest";
import {
  applyPartyDart, createPartyGame, currentPartyTarget, drawKillerNumbers, passPartyTurn, toPartyDart,
  CLOCK_TARGETS, HALVE_IT_START, HALVE_IT_TARGETS, SHANGHAI_ROUNDS, type PartyState,
} from "./partyGames";

/** Throws a list of [number, multiplier] darts one after the other. */
const play = (state: PartyState, darts: [number, number][]): PartyState => darts.reduce((s, [n, m]) => applyPartyDart(s, n, m), state);
const miss: [number, number] = [0, 1];
const fixedNumbers = () => 0.999; // leaves the pool in order: player i gets number i + 1

describe("toPartyDart", () => {
  it("reads the bullseye as a double bull and keeps singles, doubles and trebles", () => {
    expect(toPartyDart(50, 1)).toEqual({ number: 25, multiplier: 2, points: 50 });
    expect(toPartyDart(25, 1)).toEqual({ number: 25, multiplier: 1, points: 25 });
    expect(toPartyDart(20, 3)).toEqual({ number: 20, multiplier: 3, points: 60 });
    expect(toPartyDart(0, 1)).toEqual({ number: 0, multiplier: 1, points: 0 });
  });
});

describe("turns", () => {
  it("passes to the next player after three darts and does not change the earlier state", () => {
    const start = createPartyGame("clock", ["A", "B"]);
    const after = play(start, [miss, miss, miss]);
    expect(after.current).toBe(1);
    expect(after.dartsThisTurn).toBe(0);
    expect(start.current).toBe(0);
    expect(start.players[0].turnDarts).toEqual([]);
  });

  it("the next-player button fills the turn with misses", () => {
    const after = passPartyTurn(applyPartyDart(createPartyGame("clock", ["A", "B"]), 1, 1));
    expect(after.current).toBe(1);
    expect(after.players[0].turnDarts.length).toBe(3);
    expect(after.players[0].progress).toBe(1);
  });
});

describe("Around the Clock", () => {
  it("only the number that is due counts, whatever the ring", () => {
    const s = play(createPartyGame("clock", ["A", "B"]), [[1, 3], [3, 1], [2, 2]]);
    expect(s.players[0].progress).toBe(2);
  });

  it("is won by the first player through 1 to 20 and the bull", () => {
    let s = createPartyGame("clock", ["A"]);
    for (const target of CLOCK_TARGETS) s = applyPartyDart(s, target, 1);
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual([0]);
  });

  it("shows the bull as the last target", () => {
    let s = createPartyGame("clock", ["A"]);
    for (const target of CLOCK_TARGETS.slice(0, 20)) s = applyPartyDart(s, target, 1);
    expect(currentPartyTarget(s)).toEqual({ kind: "bull" });
  });
});

describe("Shanghai", () => {
  it("scores only the number of the round and moves on one number per round", () => {
    let s = play(createPartyGame("shanghai", ["A", "B"]), [[1, 3], [20, 3], miss]);
    expect(s.players[0].score).toBe(3);
    s = play(s, [miss, miss, miss]);
    expect(s.round).toBe(1);
    expect(currentPartyTarget(s)).toEqual({ kind: "number", value: 2 });
  });

  it("is won at once by single, double and treble of the number in one turn", () => {
    const s = play(createPartyGame("shanghai", ["A", "B"]), [[1, 2], [1, 1], [1, 3]]);
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual([0]);
    expect(s.wonByShanghai).toBe(true);
  });

  it("ends after seven rounds with the highest score, shared when level", () => {
    let s = createPartyGame("shanghai", ["A", "B"]);
    for (let round = 1; round <= SHANGHAI_ROUNDS; round++) s = play(s, [[round, 1], miss, miss, [round, 1], miss, miss]);
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual([0, 1]);
    expect(s.players[0].score).toBe(28);
  });
});

describe("Halve-It", () => {
  it("adds hits on the target and halves the score (rounded up) after a turn without one", () => {
    let s = play(createPartyGame("halveIt", ["A", "B"]), [[20, 3], [5, 1], miss]);
    expect(s.players[0].score).toBe(HALVE_IT_START + 60);
    s = play(s, [miss, [19, 1], miss]);
    expect(s.players[1].score).toBe(HALVE_IT_START / 2);
    expect(s.lastTurnHalved).toBe(true);
  });

  it("counts any double in the doubles round, the bullseye included", () => {
    let s = createPartyGame("halveIt", ["A"]);
    s = play(s, [[20, 1], miss, miss]); // round 1: 20
    expect(currentPartyTarget(s)).toEqual({ kind: "double" });
    s = play(s, [[7, 2], [50, 1], [7, 1]]);
    expect(s.players[0].score).toBe(HALVE_IT_START + 20 + 14 + 50);
  });

  it("ends after the last target", () => {
    let s = createPartyGame("halveIt", ["A", "B"]);
    for (let round = 0; round < HALVE_IT_TARGETS.length; round++) s = play(s, [miss, miss, miss, miss, miss, miss]);
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual([0, 1]);
  });
});

describe("Killer", () => {
  const start = () => createPartyGame("killer", ["A", "B", "C"], { lives: 2, killerZone: "double" }, fixedNumbers);

  it("gives every player a different number", () => {
    const numbers = drawKillerNumbers(8);
    expect(new Set(numbers).size).toBe(8);
    expect(start().players.map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("makes a killer of whoever hits the double of their own number, and only the double counts", () => {
    let s = play(start(), [[1, 1], [1, 3], miss]);
    expect(s.players[0].isKiller).toBe(false);
    s = play(s, [[2, 2], miss, miss]);
    expect(s.players[1].isKiller).toBe(true);
  });

  it("does not let a player who is not a killer take lives", () => {
    const s = play(start(), [[2, 2], [3, 2], miss]);
    expect(s.players.map((p) => p.lives)).toEqual([2, 2, 2]);
  });

  it("a killer takes lives, knocks players out and wins as the last one standing", () => {
    let s = play(start(), [[1, 2], [2, 2], [2, 2]]);
    expect(s.players[1].out).toBe(true);
    expect(s.current).toBe(2); // B is skipped
    s = play(s, [miss, miss, miss]);
    expect(s.current).toBe(0);
    s = play(s, [[3, 2], [3, 2]]);
    expect(s.finished).toBe(true);
    expect(s.winners).toEqual([0]);
  });

  it("a killer who hits their own double loses a life", () => {
    const s = play(start(), [[1, 2], [1, 2], miss]);
    expect(s.players[0].lives).toBe(1);
  });

  it("with the easy rule any hit on the number counts", () => {
    const s = play(createPartyGame("killer", ["A", "B"], { lives: 3, killerZone: "any" }, fixedNumbers), [[1, 1], [2, 3], miss]);
    expect(s.players[0].isKiller).toBe(true);
    expect(s.players[1].lives).toBe(2);
  });

  it("shows the own number first and the others once a killer", () => {
    expect(currentPartyTarget(start())).toEqual({ kind: "ownNumber", value: 1 });
    expect(currentPartyTarget(applyPartyDart(start(), 1, 2))).toEqual({ kind: "others" });
  });
});
