import { describe, it, expect } from "vitest";
import { bustVisitThrows } from "./bustVisit";
import { average } from "./dartStats";

describe("bustVisitThrows", () => {
  it("keeps the darts that were thrown, scores them 0 and marks them as a bust", () => {
    const visit = bustVisitThrows([{ baseValue: 20, multiplier: 3 }, { baseValue: 5, multiplier: 1 }]);
    expect(visit).toHaveLength(3);
    expect(visit.map((d) => d.points)).toEqual([0, 0, 0]);
    expect(visit.every((d) => d.bust)).toBe(true);
    expect(visit[0]).toMatchObject({ baseValue: 20, multiplier: 3 });
    expect(visit[2]).toMatchObject({ baseValue: 0, multiplier: 1 }); // the unthrown rest is padded as a miss
  });

  it("never exceeds one visit", () => {
    expect(bustVisitThrows([{ baseValue: 1, multiplier: 1 }, { baseValue: 2, multiplier: 1 }, { baseValue: 3, multiplier: 1 }, { baseValue: 4, multiplier: 1 }])).toHaveLength(3);
  });

  it("makes a busted visit count in the average instead of vanishing", () => {
    const scoring = [{ baseValue: 20, multiplier: 3, points: 60 }, { baseValue: 20, multiplier: 3, points: 60 }, { baseValue: 20, multiplier: 3, points: 60 }];
    const withoutBust = average(scoring); // 180
    const withBust = average([...scoring, ...bustVisitThrows([{ baseValue: 20, multiplier: 1 }])]);
    expect(withoutBust).toBe(180);
    expect(withBust).toBe(90); // two visits, 180 points in total
  });
});
