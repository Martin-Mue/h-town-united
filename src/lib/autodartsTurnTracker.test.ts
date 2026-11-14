import { describe, it, expect } from "vitest";
import { decideAutodartsTurn } from "./autodartsTurnTracker";
import type { AutodartsPollState } from "./autodartsClient";

const dart = (baseValue: number, multiplier: 1 | 2 | 3 = 1) => ({ baseValue, multiplier, points: 0, confidence: 1 });
const state = (over: Partial<AutodartsPollState>): AutodartsPollState => ({
  currentTurnId: "t1", currentPlayerIndex: 0, gameScores: [501], legFinished: false, matchFinished: false,
  currentTurnThrows: [], currentTurnBusted: false, currentTurnFinished: false, ...over,
});

describe("decideAutodartsTurn", () => {
  it("shows darts as pending until the third one, then commits once", () => {
    const one = decideAutodartsTurn(state({ currentTurnThrows: [dart(20)] }), null, null);
    expect(one.commits).toEqual([]);
    expect(one.pending).toHaveLength(1);
    const three = decideAutodartsTurn(state({ currentTurnThrows: [dart(20), dart(20), dart(7)] }), one.seen, null);
    expect(three.commits).toHaveLength(1);
    expect(three.pending).toEqual([]);
    const again = decideAutodartsTurn(state({ currentTurnThrows: [dart(20), dart(20), dart(7)] }), three.seen, "t1");
    expect(again.commits).toEqual([]);
  });

  it("commits a bust right away", () => {
    const d = decideAutodartsTurn(state({ currentTurnThrows: [dart(20, 3)], currentTurnBusted: true }), null, null);
    expect(d.commits).toEqual([{ turnId: "t1", throws: [dart(20, 3)], busted: true }]);
  });

  it("commits a checkout with fewer than three darts", () => {
    const d = decideAutodartsTurn(state({ currentTurnThrows: [dart(16, 2)], legFinished: true }), null, null);
    expect(d.commits).toHaveLength(1);
  });

  it("safety net: a new turn id commits the previous turn last seen with darts", () => {
    const seen = { turnId: "t1", throws: [dart(20), dart(5)], busted: false };
    const d = decideAutodartsTurn(state({ currentTurnId: "t2", currentTurnThrows: [] }), seen, null);
    expect(d.commits).toEqual([{ turnId: "t1", throws: seen.throws, busted: false }]);
  });

  it("never re-commits a turn that was already committed", () => {
    const seen = { turnId: "t1", throws: [dart(20), dart(20), dart(20)], busted: false };
    const d = decideAutodartsTurn(state({ currentTurnId: "t2" }), seen, "t1");
    expect(d.commits).toEqual([]);
  });
});

import { mapSegmentToDetectedDart } from "./autodartsClient";
describe("mapSegmentToDetectedDart", () => {
  it("scores real Autodarts segments", () => {
    expect(mapSegmentToDetectedDart({ name: "S20", number: 20, bed: "SingleInner", multiplier: 1 } as never)).toMatchObject({ baseValue: 20, multiplier: 1, points: 20 });
    expect(mapSegmentToDetectedDart({ number: 20, bed: "Triple", multiplier: 3 })).toMatchObject({ points: 60 });
    expect(mapSegmentToDetectedDart({ number: 25, bed: "Double", multiplier: 2 })).toMatchObject({ baseValue: 25, multiplier: 2, points: 50 });
  });
  it("a miss next to the board is 0, not a single", () => {
    expect(mapSegmentToDetectedDart({ number: 20, bed: "Outside", multiplier: 0 })).toMatchObject({ baseValue: 0, points: 0 });
  });
});
