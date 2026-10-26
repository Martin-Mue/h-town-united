import { describe, expect, it } from "vitest";
import { looksLikeUndetectedDarts, UNEXPLAINED_CHANGE_MAX_SHARE, UNEXPLAINED_CHANGE_MIN_SHARE } from "./unexplainedChange";

describe("looksLikeUndetectedDarts", () => {
  it("ignores noise and shadows", () => {
    expect(looksLikeUndetectedDarts(0)).toBe(false);
    expect(looksLikeUndetectedDarts(0.0008)).toBe(false);
    expect(looksLikeUndetectedDarts(UNEXPLAINED_CHANGE_MIN_SHARE - 0.0001)).toBe(false);
  });
  it("accepts a dart-sized difference", () => {
    expect(looksLikeUndetectedDarts(0.005)).toBe(true);
    expect(looksLikeUndetectedDarts(0.03)).toBe(true);
  });
  it("ignores a hand or an exposure jump", () => {
    expect(looksLikeUndetectedDarts(UNEXPLAINED_CHANGE_MAX_SHARE)).toBe(false);
    expect(looksLikeUndetectedDarts(0.6)).toBe(false);
  });
});
