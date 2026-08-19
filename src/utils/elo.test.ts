import { describe, it, expect } from "vitest";
import { computeEloDeltas } from "./elo";

describe("computeEloDeltas", () => {
  it("matches classic 1v1 Elo for exactly 2 participants", () => {
    const deltas = computeEloDeltas([
      { id: "a", rating: 1000, rank: 1 },
      { id: "b", rating: 1000, rank: 2 },
    ]);
    // Equal ratings → expected 0.5 each → K_FACTOR * (1 - 0.5) = 16
    expect(deltas.a).toBeCloseTo(16);
    expect(deltas.b).toBeCloseTo(-16);
  });

  it("is zero-sum for an uneven-rating 1v1", () => {
    const deltas = computeEloDeltas([
      { id: "underdog", rating: 900, rank: 1 }, // lower-rated player wins
      { id: "favorite", rating: 1100, rank: 2 },
    ]);
    expect(deltas.underdog).toBeGreaterThan(16); // beating a favorite is worth more than 16
    expect(deltas.underdog + deltas.favorite).toBeCloseTo(0);
  });

  it("gives 2nd place zero net change against equally-rated opponents, not a loss", () => {
    // The whole point of the redesign: under the old winner-vs-everyone-else model, 2nd place
    // lost the same as last place. Pairwise, 2nd beats 3rd (gains) and loses to 1st (loses) —
    // with all three equally rated those cancel out exactly.
    const deltas = computeEloDeltas([
      { id: "first", rating: 1000, rank: 1 },
      { id: "second", rating: 1000, rank: 2 },
      { id: "third", rating: 1000, rank: 3 },
    ]);
    expect(deltas.first).toBeCloseTo(16);
    expect(deltas.second).toBeCloseTo(0);
    expect(deltas.third).toBeCloseTo(-16);
    expect(deltas.first + deltas.second + deltas.third).toBeCloseTo(0);
  });

  it("treats a shared rank as a draw between that pair, still ranked against the rest", () => {
    const deltas = computeEloDeltas([
      { id: "winner", rating: 1000, rank: 1 },
      { id: "tiedA", rating: 1000, rank: 2 },
      { id: "tiedB", rating: 1000, rank: 2 },
    ]);
    // tiedA vs tiedB: equal rank + equal rating → expected 0.5, actual 0.5 → exactly cancels
    expect(deltas.tiedA).toBeCloseTo(deltas.tiedB);
    // Both still lose to the winner (rank 1 beats rank 2) by the same amount, symmetric loss
    expect(deltas.winner).toBeCloseTo(-(deltas.tiedA + deltas.tiedB));
    expect(deltas.winner).toBeGreaterThan(0);
  });

  it("is zero-sum for a larger uneven-rating field", () => {
    const deltas = computeEloDeltas([
      { id: "a", rating: 1200, rank: 2 },
      { id: "b", rating: 950, rank: 1 },
      { id: "c", rating: 1000, rank: 4 },
      { id: "d", rating: 1100, rank: 3 },
    ]);
    const total = Object.values(deltas).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(0);
  });

  it("returns all-zero deltas for fewer than 2 participants (no pairs to compare)", () => {
    expect(computeEloDeltas([])).toEqual({});
    expect(computeEloDeltas([{ id: "solo", rating: 1000, rank: 1 }])).toEqual({ solo: 0 });
  });
});
