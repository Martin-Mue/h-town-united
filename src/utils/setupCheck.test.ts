import { describe, expect, it } from "vitest";
import { assessSetup } from "./setupCheck";

describe("assessSetup", () => {
  it("accepts a good picture", () => {
    expect(assessSetup({ brightness: 120, contrast: 50, calibQuality: 0.85 })).toBeNull();
  });
  it("reports the most important problem first", () => {
    expect(assessSetup({ brightness: 40, contrast: 10, calibQuality: 0.2 })).toBe("dark");
    expect(assessSetup({ brightness: 200 })).toBe("bright");
    expect(assessSetup({ brightness: 120, contrast: 20 })).toBe("flat");
    expect(assessSetup({ brightness: 120, contrast: 50, calibQuality: 0.4 })).toBe("weakFit");
  });
  it("says nothing about facts it does not have", () => {
    expect(assessSetup({})).toBeNull();
    expect(assessSetup({ calibQuality: null })).toBeNull();
  });
});
