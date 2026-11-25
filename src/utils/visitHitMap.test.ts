import { describe, it, expect } from "vitest";
import { visitSpreadMm } from "./visitHitMap";

describe("visitSpreadMm", () => {
  it("is 0 for darts in one hole and grows with the distance between them", () => {
    expect(visitSpreadMm([{ boardU: 0.1, boardV: 0.1 }, { boardU: 0.1, boardV: 0.1 }])).toBeCloseTo(0, 6);
    // two darts 20 mm apart sit 10 mm from their middle
    expect(visitSpreadMm([{ boardU: 0, boardV: 0 }, { boardU: 20 / 170, boardV: 0 }])).toBeCloseTo(10, 6);
  });
  it("needs at least two darts with a position", () => {
    expect(visitSpreadMm([{ boardU: 0, boardV: 0 }, {}])).toBeNull();
    expect(visitSpreadMm([])).toBeNull();
  });
});
