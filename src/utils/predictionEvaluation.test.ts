import { describe, it, expect } from "vitest";
import { evaluatePredictions } from "./predictionEvaluation";
import type { Match } from "./tournament";

const m = (id: string, p1: string, p2: string, winner?: string): Match => ({ id, round: 1, position: 0, player1: p1, player2: p2, winner });

describe("evaluatePredictions", () => {
  it("counts total tips, crowd and own accuracy on decided matches only", () => {
    const matches = [m("a", "A", "B", "A"), m("b", "C", "D", "D"), m("c", "E", "F")];
    const tallies = { a: { A: 3, B: 1 }, b: { C: 2, D: 1 }, c: { E: 5 } };
    const r = evaluatePredictions(matches, tallies, { a: "A", b: "C", c: "E" });
    expect(r.totalTips).toBe(12);
    expect(r.crowdDecided).toBe(2);
    expect(r.crowdCorrect).toBe(1); // crowd right on a, wrong on b
    expect(r.myDecided).toBe(2);
    expect(r.myCorrect).toBe(1);
    expect(r.tipAccuracyPct).toBe(Math.round((3 + 1) / 7 * 100));
    expect(r.decided).toHaveLength(2);
  });
  it("treats a tie as no crowd verdict and skips untipped matches", () => {
    const r = evaluatePredictions([m("a", "A", "B", "A"), m("z", "X", "Y", "X")], { a: { A: 1, B: 1 } }, {});
    expect(r.decided).toHaveLength(1);
    expect(r.crowdDecided).toBe(0);
    expect(r.tipAccuracyPct).toBe(50);
  });
});
