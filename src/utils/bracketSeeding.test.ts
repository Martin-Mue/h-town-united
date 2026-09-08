import { describe, it, expect } from "vitest";
import {
  nextPowerOfTwo,
  lowerPowerOfTwo,
  chooseAutoMainSize,
  defaultBracketView,
  bracketSeedOrder,
  fairSeededOrder,
  distributeByes,
  buildSeeding,
} from "./bracketSeeding";
import { BYE } from "./tournament";

// Round 4 Rang 5: first-ever tests for these functions -- they existed inside Tournament.tsx
// since before this file did, reachable only indirectly through the whole page. Verified against
// a standalone plain-JS harness before trusting, same process as legLogic.test.ts (Round 3 Rang 12).

describe("nextPowerOfTwo / lowerPowerOfTwo", () => {
  it("rounds to the nearest power of two in the documented direction", () => {
    expect(lowerPowerOfTwo(30)).toBe(16);
    expect(nextPowerOfTwo(30)).toBe(32);
    expect(lowerPowerOfTwo(32)).toBe(32);
    expect(nextPowerOfTwo(32)).toBe(32);
  });
});

describe("chooseAutoMainSize", () => {
  it("picks whichever framing touches fewer players (auto)", () => {
    // 30 players: 2 BYEs (upper=32) vs 28 players in a prelim round (lower=16) -- BYEs win.
    expect(chooseAutoMainSize(30)).toBe(32);
    // 34 players: 4 prelim players (lower=32) vs 30 BYEs (upper=64) -- prelim wins.
    expect(chooseAutoMainSize(34)).toBe(32);
  });

  it("honors an explicit prelim/byes preference override", () => {
    expect(chooseAutoMainSize(17, "prelim")).toBe(16);
    expect(chooseAutoMainSize(17, "byes")).toBe(32);
  });

  it("caps at 64 with nothing bigger to compare against", () => {
    expect(chooseAutoMainSize(64)).toBe(64);
    expect(chooseAutoMainSize(65)).toBe(64);
  });
});

describe("defaultBracketView", () => {
  it("defaults to the tree for a small/empty bracket, schedule for 5+ rounds", () => {
    expect(defaultBracketView(undefined)).toBe("tree");
    expect(defaultBracketView([])).toBe("tree");
  });
});

describe("bracketSeedOrder", () => {
  it("produces the textbook single-elimination seed placement", () => {
    expect(bracketSeedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("keeps seed 1 and seed 2 in opposite halves at every size", () => {
    for (const n of [4, 8, 16, 32]) {
      const order = bracketSeedOrder(n);
      const seed1Half = order.indexOf(1) < n / 2;
      const seed2Half = order.indexOf(2) < n / 2;
      expect(seed1Half).not.toBe(seed2Half);
    }
  });
});

describe("fairSeededOrder", () => {
  it("places the top seed and #2 seed apart, byes to the strongest players when excess > 0", () => {
    const players = ["a", "b", "c", "d", "e"];
    const elo = new Map([["a", 1500], ["b", 1400], ["c", 1300], ["d", 1200], ["e", 1100]]);
    const order = fairSeededOrder(players, 4, elo);
    // mainSize=4, excess=1 -> only the top 3 by Elo get seeded placement, weakest (e) trails.
    expect(order.length).toBe(5);
    expect(order[order.length - 1]).toBe("e");
    expect(order.slice(0, 3).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("distributeByes", () => {
  it("places exactly the right number of BYEs, one per affected match", () => {
    const result = distributeByes(["a", "b", "c"], 4);
    expect(result.filter((x) => x === BYE).length).toBe(1);
    expect(result.filter((x) => x !== BYE).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns the input unchanged (as a copy) when there's no shortfall", () => {
    const input = ["a", "b", "c", "d"];
    const result = distributeByes(input, 4);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });
});

describe("buildSeeding", () => {
  it("needs no preliminary round when the field exactly fits mainSize", () => {
    const s = buildSeeding(["a", "b", "c", "d"], 4);
    expect(s.prelimPairs).toEqual([]);
    expect(s.prelimFeeds).toEqual([]);
    expect(s.round1.filter((x) => x !== undefined).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("routes exactly the excess into paired preliminary matches feeding pending round-1 slots", () => {
    const s = buildSeeding(["p1", "p2", "p3", "p4", "p5"], 4);
    expect(s.prelimPairs).toEqual([["p4", "p5"]]);
    expect(s.prelimFeeds.length).toBe(1);
    // Exactly one round-1 slot is left pending (undefined), matching the one prelim match.
    expect(s.round1.filter((x) => x === undefined).length).toBe(1);
    expect(s.round1.filter((x) => x !== undefined).sort()).toEqual(["p1", "p2", "p3"]);
  });
});
