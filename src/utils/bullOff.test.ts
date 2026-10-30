import { describe, expect, it } from "vitest";
import type { GameState } from "@/types/game";
import { applyBullOffWinner, BULLOFF_TIE_MM, decideBullOff, distanceFromBullMm, zoneDistanceMm } from "./bullOff";
import { createLegState } from "./gameStateFactory";

const baseGame = (): GameState => {
  const players = [{ name: "A", doubleOut: true, doubleIn: false, isBot: false }, { name: "B", doubleOut: true, doubleIn: false, isBot: false }];
  return {
    mode: "501", startScore: 501, bestOfLegs: 3, players, legsWon: [0, 0],
    currentLeg: createLegState(1, 501, 0, players), completedLegs: [], currentPlayerIndex: 0, isFinished: false,
  };
};

describe("bull-off", () => {
  it("measures the distance from the bull in millimetres", () => {
    expect(distanceFromBullMm(0, 0)).toBe(0);
    expect(distanceFromBullMm(0.1, 0)).toBeCloseTo(17, 1);
    expect(distanceFromBullMm(0.06, -0.08)).toBeCloseTo(17, 1); // 3-4-5 triangle -> radius 0.1
    expect(distanceFromBullMm(1, 0)).toBe(170);
  });

  it("waits until both darts are in", () => {
    expect(decideBullOff([null, null]).status).toBe("waiting");
    expect(decideBullOff([12, null]).status).toBe("waiting");
  });

  it("the closer dart wins, whichever side it belongs to", () => {
    expect(decideBullOff([12, 30])).toEqual({ status: "winner", winner: 0, closerByMm: 18 });
    expect(decideBullOff([40, 9.5])).toEqual({ status: "winner", winner: 1, closerByMm: 30.5 });
  });

  it("a difference below the camera accuracy is a tie", () => {
    expect(decideBullOff([20, 20 + BULLOFF_TIE_MM - 0.1]).status).toBe("tie");
    expect(decideBullOff([20, 20 + BULLOFF_TIE_MM]).status).toBe("winner");
  });

  it("manual zones order sensibly and equal zones tie", () => {
    expect(zoneDistanceMm("bullseye")).toBeLessThan(zoneDistanceMm("bull"));
    expect(zoneDistanceMm("far")).toBeLessThan(zoneDistanceMm("miss"));
    expect(decideBullOff([zoneDistanceMm("near"), zoneDistanceMm("near")]).status).toBe("tie");
  });

  it("applies the winner as first thrower of leg 1 without touching the scores", () => {
    const g = baseGame();
    const out = applyBullOffWinner(g, 1);
    expect(out.currentPlayerIndex).toBe(1);
    expect(out.currentLeg.startingPlayerIndex).toBe(1);
    expect(out.currentLeg.remaining).toEqual(g.currentLeg.remaining);
    expect(out.bullOff?.resolved).toBe(true);
    expect(out.bullOff?.winner).toBe(1);
    expect(g.currentPlayerIndex).toBe(0); // input untouched
  });
});
