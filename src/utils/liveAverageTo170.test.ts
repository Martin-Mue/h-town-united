import { describe, it, expect } from "vitest";
import type { GameState } from "@/types/game";
import { liveAveragesTo170 } from "./liveAverageTo170";

const t20 = { baseValue: 20, multiplier: 3, points: 60 };
const s1 = { baseValue: 1, multiplier: 1, points: 1 };

describe("liveAveragesTo170", () => {
  it("pools finished legs and the current leg per player, null without a scoring phase", () => {
    const game = {
      startScore: 501,
      players: [{ name: "A" }, { name: "B" }],
      teams: undefined,
      completedLegs: [{ throws: [[t20, t20, t20], []] }],
      currentLeg: { throws: [[t20, t20, t20], [s1, s1, s1]] },
    } as unknown as GameState;
    const [a, b] = liveAveragesTo170(game);
    expect(a).toBe(180);
    expect(b).toBe(3);
  });

  it("is null for a player who has not thrown yet", () => {
    const game = {
      startScore: 501, players: [{ name: "A" }, { name: "B" }], teams: undefined,
      completedLegs: [], currentLeg: { throws: [[t20], []] },
    } as unknown as GameState;
    expect(liveAveragesTo170(game)[1]).toBeNull();
  });
});
