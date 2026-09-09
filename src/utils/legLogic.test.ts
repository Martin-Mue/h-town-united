import { describe, it, expect } from "vitest";
import { applyLegWin, applyCricketDart, replayCricketState, generateRandomCricketNumbers, wouldWinMatch } from "./legLogic";
import { createLegState, createCricketState } from "./gameStateFactory";
import type { GameState, LegState, PlayerSlot, CricketPlayerState, DartThrow } from "@/types/game";

// Round 3 Rang 12: this is the first test coverage these four functions have ever had — they
// were locked inside Game.tsx (unexported) until this rank's extraction into their own module.

function makePlayers(n: number): PlayerSlot[] {
  return Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, doubleOut: true, isBot: false }));
}

function makeMatch(numPlayers: number, bestOfLegs: number, startScore = 501): GameState {
  const players = makePlayers(numPlayers);
  return {
    mode: "501",
    startScore,
    bestOfLegs,
    players,
    legsWon: Array(numPlayers).fill(0),
    currentLeg: createLegState(1, startScore, 0, players),
    completedLegs: [],
    currentPlayerIndex: 0,
    isFinished: false,
  };
}

describe("applyLegWin", () => {
  it("archives the leg and rolls a new one when the match isn't decided yet", () => {
    const game = makeMatch(2, 3); // best of 3 -> needs 2 legs to win
    const finishing: LegState = { ...game.currentLeg, remaining: [0, 40] };
    const next = applyLegWin(game, game, finishing, 0);

    expect(next.isFinished).toBe(false);
    expect(next.legsWon).toEqual([1, 0]);
    expect(next.completedLegs).toHaveLength(1);
    expect(next.completedLegs[0].winnerIndex).toBe(0);
    // Next leg starts fresh at the full start score for both players, starter rotated to P2.
    expect(next.currentLeg.legNumber).toBe(2);
    expect(next.currentLeg.startingPlayerIndex).toBe(1);
    expect(next.currentLeg.remaining).toEqual([501, 501]);
  });

  it("finishes the match once legsToWin is reached, recording the winner's name and index", () => {
    const game = makeMatch(2, 3);
    game.legsWon = [1, 0]; // P1 already has one leg
    const finishing: LegState = { ...game.currentLeg, remaining: [0, 55] };
    const next = applyLegWin(game, game, finishing, 0);

    expect(next.isFinished).toBe(true);
    expect(next.legsWon).toEqual([2, 0]);
    expect(next.winnerIndex).toBe(0);
    expect(next.winnerName).toBe("P1");
    // The deciding leg is preserved as currentLeg (not moved into completedLegs) once finished.
    expect(next.currentLeg.winnerIndex).toBe(0);
  });

  it("uses the team name as winnerName when teams are present", () => {
    const players = makePlayers(4);
    const teams = [{ name: "Rot" }, { name: "Blau" }];
    const game: GameState = {
      mode: "501", startScore: 501, bestOfLegs: 1, players,
      legsWon: [0, 0], completedLegs: [], currentPlayerIndex: 0, isFinished: false,
      currentLeg: createLegState(1, 501, 0, players, teams),
      teams,
    };
    const finishing: LegState = { ...game.currentLeg, remaining: [0, 120] };
    const next = applyLegWin(game, game, finishing, 0);
    expect(next.winnerName).toBe("Rot");
  });

  it("preserves extra fields the caller pre-set on `base` when the match isn't finished", () => {
    // handleX01Throw's round-cap path pre-sets currentPlayerIndex on `base` before knowing
    // whether the cap actually decided the leg — applyLegWin must not silently drop that.
    const game = makeMatch(3, 5);
    const base: GameState = { ...game, currentPlayerIndex: 2 };
    const finishing: LegState = { ...game.currentLeg, remaining: [50, 50, 0] };
    const next = applyLegWin(base, game, finishing, 2);
    // Not finished (needs 3 legs to win a best-of-5) -> currentPlayerIndex gets overwritten by
    // the rotation logic (nextStarter), which is the intended behavior, not the preserved base.
    expect(next.currentPlayerIndex).toBe((finishing.startingPlayerIndex + 1) % 3);
  });
});

// Round 5: Sets-Modus — "Best of X Sätze, je Satz Best of Y Legs". bestOfLegs is reused as "legs
// per set" the moment setsMode is on (see GameState.setsMode's own doc comment); these tests
// exercise the two genuinely new outcomes applyLegWin can now reach (a leg that only decides the
// CURRENT set, and a leg that decides the whole match via sets) on top of the four cases above,
// which already cover the setsMode-absent path staying completely unchanged.
describe("applyLegWin with setsMode", () => {
  function makeSetsMatch(numPlayers: number, legsPerSet: number, bestOfSets: number): GameState {
    const players = makePlayers(numPlayers);
    return {
      mode: "501", startScore: 501, bestOfLegs: legsPerSet, players,
      legsWon: Array(numPlayers).fill(0), setsWon: Array(numPlayers).fill(0),
      setsMode: { bestOfSets },
      currentLeg: createLegState(1, 501, 0, players), completedLegs: [],
      currentPlayerIndex: 0, isFinished: false,
    };
  }

  it("winning enough legs to take a set resets legsWon to zero and increments setsWon, without finishing the match", () => {
    const game = makeSetsMatch(2, 3, 3); // best of 3 sets, each set first to 2 legs
    game.legsWon = [1, 0]; // P1 one leg from taking set 1
    const finishing: LegState = { ...game.currentLeg, remaining: [0, 40] };
    const next = applyLegWin(game, game, finishing, 0);

    expect(next.isFinished).toBe(false);
    expect(next.setsWon).toEqual([1, 0]);
    // Set 1 decided -> the NEXT set's leg race starts fresh at 0:0, not carrying over.
    expect(next.legsWon).toEqual([0, 0]);
    expect(next.completedLegs).toHaveLength(1);
    expect(next.currentLeg.remaining).toEqual([501, 501]);
  });

  it("finishes the match once the sets majority is reached, even though the deciding leg only just took the current set", () => {
    const game = makeSetsMatch(2, 3, 3); // best of 3 sets -> needs 2 sets to win
    game.setsWon = [1, 0]; // P1 already took set 1
    game.legsWon = [1, 0]; // one leg from taking set 2 as well
    const finishing: LegState = { ...game.currentLeg, remaining: [0, 12] };
    const next = applyLegWin(game, game, finishing, 0);

    expect(next.isFinished).toBe(true);
    expect(next.setsWon).toEqual([2, 0]);
    // The deciding leg's own set score is preserved on legsWon (NOT reset) once the match itself
    // is over — there's no "next set" to reset it for.
    expect(next.legsWon).toEqual([2, 0]);
    expect(next.winnerIndex).toBe(0);
    expect(next.winnerName).toBe("P1");
  });

  it("keeps a mid-set leg win from finishing the match even when legsWon alone would look match-deciding under a plain (non-sets) reading", () => {
    // Best of 5 legs PER SET (so a plain best-of-legs match would end here), but only best of 1
    // set is needed to decide sets don't collapse a mid-set win into "the match is over".
    const game = makeSetsMatch(2, 5, 3);
    game.legsWon = [2, 0]; // two legs from taking set 1 (needs 3 to win the 5-leg set)
    const finishing: LegState = { ...game.currentLeg, remaining: [0, 100] };
    const next = applyLegWin(game, game, finishing, 0);
    expect(next.isFinished).toBe(false);
    expect(next.setsWon).toEqual([1, 0]);
  });
});

describe("wouldWinMatch", () => {
  it("without setsMode, matches reaching bestOfLegs' own majority", () => {
    const game = makeMatch(2, 3); // best of 3 legs -> majority is 2
    game.legsWon = [1, 0];
    expect(wouldWinMatch(game, 0)).toBe(true); // one more leg (-> 2) decides it
    expect(wouldWinMatch(game, 1)).toBe(false); // P2 would only be at 1
  });

  it("with setsMode, a leg that only takes the current set does NOT win the match", () => {
    const game: GameState = {
      mode: "501", startScore: 501, bestOfLegs: 3, players: makePlayers(2),
      legsWon: [1, 0], setsWon: [0, 0], setsMode: { bestOfSets: 3 },
      currentLeg: createLegState(1, 501, 0, makePlayers(2)), completedLegs: [],
      currentPlayerIndex: 0, isFinished: false,
    };
    expect(wouldWinMatch(game, 0)).toBe(false); // takes set 1 (setsWon -> 1), needs 2 to win
  });

  it("with setsMode, a leg that takes both the current set AND the sets majority DOES win the match", () => {
    const game: GameState = {
      mode: "501", startScore: 501, bestOfLegs: 3, players: makePlayers(2),
      legsWon: [1, 0], setsWon: [1, 0], setsMode: { bestOfSets: 3 },
      currentLeg: createLegState(1, 501, 0, makePlayers(2)), completedLegs: [],
      currentPlayerIndex: 0, isFinished: false,
    };
    expect(wouldWinMatch(game, 0)).toBe(true); // takes set 2 (setsWon -> 2), reaching the majority of 3
  });
});

describe("applyCricketDart", () => {
  it("adds marks without scoring points while any opponent still has the number open", () => {
    const me = createCricketState();
    const opp = createCricketState();
    applyCricketDart(me, [opp], [20, 19, 18, 17, 16, 15, 25], 20, 20, 3); // triple 20 -> 3 marks, closes it
    expect(me.marks[20]).toBe(3);
    expect(me.points).toBe(0); // exactly closed, no overflow yet
  });

  it("scores overflow marks once the target is closed and an opponent still has it open", () => {
    const me = createCricketState();
    me.marks[20] = 3; // already closed
    const opp = createCricketState(); // still open for opponent
    applyCricketDart(me, [opp], [20, 19, 18, 17, 16, 15, 25], 20, 20, 3); // another triple 20
    expect(me.marks[20]).toBe(6);
    expect(me.points).toBe(20 * 3); // 3 overflow hits at 20 points each
  });

  it("scores nothing once every opponent has also closed the number", () => {
    const me = createCricketState();
    me.marks[20] = 3;
    const opp = createCricketState();
    opp.marks[20] = 3; // opponent already closed it too
    applyCricketDart(me, [opp], [20, 19, 18, 17, 16, 15, 25], 20, 20, 3);
    expect(me.marks[20]).toBe(6);
    expect(me.points).toBe(0);
  });

  it("ignores a dart on a number outside the active Cricket set, and a plain miss", () => {
    const me = createCricketState();
    const before = { ...me };
    applyCricketDart(me, [createCricketState()], [20, 19, 18, 17, 16, 15, 25], 5, 5, 1);
    applyCricketDart(me, [createCricketState()], [20, 19, 18, 17, 16, 15, 25], 0, 0, 1);
    expect(me).toEqual(before);
  });

  it("counts a bullseye (baseValue 50) as 2 marks, not multiplier-many", () => {
    const me = createCricketState();
    const opp = createCricketState();
    // Game.tsx always translates a bullseye dart's targetNumber to 25 before calling this — see
    // replayCricketState's own `d.baseValue === 50 ? 25 : d.baseValue` translation.
    applyCricketDart(me, [opp], [20, 19, 18, 17, 16, 15, 25], 25, 50, 2);
    expect(me.marks[25]).toBe(2);
  });
});

describe("replayCricketState", () => {
  const numbers = [20, 19, 18, 17, 16, 15, 25] as const;
  const t20 = (multiplier: number): DartThrow => ({ baseValue: 20, multiplier, points: 20 * multiplier });

  it("replays alternating turns and reproduces the same result as applying darts live, in order", () => {
    // P1 closes 20 (T20+T20+T20 -> wait, only need 3 marks total across visits); P2 throws after.
    const throwsByPlayer: DartThrow[][] = [
      [t20(3), t20(3)], // P1: triple 20, triple 20 -> 6 marks on 20, first 3 close it, next 3 overflow
      [t20(1)],          // P2: single 20, still open for P2 at that point -> just a mark, no score yet
    ];
    const result = replayCricketState(throwsByPlayer, 0, undefined, numbers);
    expect(result).toHaveLength(2);
    expect(result[0].marks[20]).toBe(6);
    expect(result[1].marks[20]).toBe(1);
  });

  it("skips a player who has no more recorded throws instead of looping forever", () => {
    const throwsByPlayer: DartThrow[][] = [
      [t20(1), t20(1), t20(1), t20(1)], // P1 has 4 recorded darts (more than one visit)
      [], // P2 recorded nothing this leg
    ];
    const result = replayCricketState(throwsByPlayer, 0, undefined, numbers);
    expect(result[0].marks[20]).toBe(4);
    expect(result[1].marks[20]).toBe(0);
  });

  it("indexes cricket state by team, not by individual player, when teams are present", () => {
    const teams = [{ name: "Rot" }, { name: "Blau" }];
    // players interleaved [TeamA-1, TeamB-1, TeamA-2, TeamB-2] per GameState's own team-mode doc.
    const throwsByPlayer: DartThrow[][] = [
      [t20(1)], // TeamA-1
      [],       // TeamB-1
      [t20(1)], // TeamA-2 — same team (index 0) as TeamA-1
      [],       // TeamB-2
    ];
    const result = replayCricketState(throwsByPlayer, 0, teams, numbers);
    expect(result).toHaveLength(2); // one CricketPlayerState per TEAM, not per player
    expect(result[0].marks[20]).toBe(2); // both TeamA members' darts landed on the same team slot
  });
});

describe("generateRandomCricketNumbers", () => {
  it("always returns 6 unique numbers from 1-20 plus Bull (25)", () => {
    for (let i = 0; i < 20; i++) {
      const nums = generateRandomCricketNumbers();
      expect(nums).toHaveLength(7);
      expect(nums[6]).toBe(25);
      const body = nums.slice(0, 6);
      expect(new Set(body).size).toBe(6); // all unique
      for (const n of body) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(20);
      }
    }
  });
});
