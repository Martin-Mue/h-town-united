import { describe, it, expect } from "vitest";
import { decideAutodartsTurn, shouldReleaseHeldVisit, HELD_VISIT_FALLBACK_MS, type HeldAutodartsVisit } from "./autodartsTurnTracker";
import { mapSegmentToDetectedDart, type AutodartsPollState } from "./autodartsClient";

const dart = (baseValue: number, multiplier: 1 | 2 | 3 = 1) => ({ baseValue, multiplier, points: baseValue * multiplier, confidence: 1 });
const state = (over: Partial<AutodartsPollState>): AutodartsPollState => ({
  hasMatchState: true, board: null, currentTurnId: "t1", currentPlayerIndex: 0, gameScores: [501], legFinished: false, matchFinished: false,
  currentTurnThrows: [], currentTurnBusted: false, currentTurnFinished: false, ...over,
});
const held = (over: Partial<HeldAutodartsVisit> = {}): HeldAutodartsVisit => ({
  turnId: "t1", throws: [dart(20), dart(20), dart(20)], busted: false, edited: false, heldAt: 0, ...over,
});

describe("decideAutodartsTurn", () => {
  it("open darts are pending, the third dart finishes the visit once", () => {
    const one = decideAutodartsTurn(state({ currentTurnThrows: [dart(20)] }), null, null);
    expect(one.finished).toEqual([]);
    expect(one.pending).toHaveLength(1);
    const three = decideAutodartsTurn(state({ currentTurnThrows: [dart(20), dart(20), dart(7)] }), one.seen, null);
    expect(three.finished).toHaveLength(1);
    expect(three.pending).toEqual([]);
    const again = decideAutodartsTurn(state({ currentTurnThrows: [dart(20), dart(20), dart(7)] }), three.seen, "t1");
    expect(again.finished).toEqual([]);
  });

  it("a bust finishes the visit right away and is reported as such", () => {
    const d = decideAutodartsTurn(state({ currentTurnThrows: [dart(20, 3)], currentTurnBusted: true }), null, null);
    expect(d.finished).toEqual([{ turnId: "t1", throws: [dart(20, 3)], busted: true }]);
  });

  it("a checkout with fewer than three darts finishes the visit", () => {
    expect(decideAutodartsTurn(state({ currentTurnThrows: [dart(16, 2)], legFinished: true }), null, null).finished).toHaveLength(1);
  });

  it("safety net: a new turn id finishes the previous turn last seen with darts", () => {
    const seen = { turnId: "t1", throws: [dart(20), dart(5)], busted: false };
    const d = decideAutodartsTurn(state({ currentTurnId: "t2" }), seen, null);
    expect(d.finished).toEqual([seen]);
    expect(decideAutodartsTurn(state({ currentTurnId: "t2" }), seen, "t1").finished).toEqual([]);
  });
});

describe("decideAutodartsTurn with a poll that carried no match state", () => {
  it("keeps the open visit as it is instead of taking it over early", () => {
    const two = decideAutodartsTurn(state({ currentTurnThrows: [dart(20), dart(20)] }), null, null);
    const empty = decideAutodartsTurn(state({ hasMatchState: false, currentTurnId: null }), two.seen, null);
    expect(empty.finished).toEqual([]);
    expect(empty.pending).toHaveLength(2);
    expect(empty.seen).toEqual(two.seen);
    const three = decideAutodartsTurn(state({ currentTurnThrows: [dart(20), dart(20), dart(1)] }), empty.seen, null);
    expect(three.finished).toEqual([{ turnId: "t1", throws: [dart(20), dart(20), dart(1)], busted: false }]);
  });
});

describe("shouldReleaseHeldVisit", () => {
  it("waits while darts are in the board or the takeout runs", () => {
    expect(shouldReleaseHeldVisit(held(), { status: "Throw", numThrows: 3 }, null, 5_000)).toBe(false);
    expect(shouldReleaseHeldVisit(held(), { status: "Takeout", numThrows: 0 }, null, 5_000)).toBe(false);
    expect(shouldReleaseHeldVisit(held(), { status: "Takeout in progress", numThrows: 0 }, null, 5_000)).toBe(false);
  });
  it("goes into the game once the board is clear again (not in the first moments)", () => {
    expect(shouldReleaseHeldVisit(held(), { status: "Throw", numThrows: 0 }, null, 5_000)).toBe(true);
    expect(shouldReleaseHeldVisit(held(), { status: "Throw", numThrows: 0 }, null, 500)).toBe(false);
  });
  it("goes in when the player already throws the next visit", () => {
    expect(shouldReleaseHeldVisit(held(), { status: "Throw", numThrows: 1 }, { turnId: "t2", throws: [dart(5)], busted: false }, 3_000)).toBe(true);
  });
  it("without a usable board state, after the fallback time", () => {
    expect(shouldReleaseHeldVisit(held(), null, null, HELD_VISIT_FALLBACK_MS - 1)).toBe(false);
    expect(shouldReleaseHeldVisit(held(), { status: "Stopped", numThrows: 0 }, null, HELD_VISIT_FALLBACK_MS)).toBe(true);
  });
});

describe("mapSegmentToDetectedDart", () => {
  it("scores real Autodarts segments", () => {
    expect(mapSegmentToDetectedDart({ number: 20, bed: "SingleInner", multiplier: 1 })).toMatchObject({ baseValue: 20, multiplier: 1, points: 20 });
    expect(mapSegmentToDetectedDart({ number: 20, bed: "Triple", multiplier: 3 })).toMatchObject({ points: 60 });
    expect(mapSegmentToDetectedDart({ number: 25, bed: "Double", multiplier: 2 })).toMatchObject({ baseValue: 25, multiplier: 2, points: 50 });
  });
  it("a miss next to the board is 0, not a single", () => {
    expect(mapSegmentToDetectedDart({ number: 20, bed: "Outside", multiplier: 0 })).toMatchObject({ baseValue: 0, points: 0 });
  });
});
