import { describe, it, expect } from "vitest";
import { isBustThrow, isQualifyingDouble } from "./x01Rules";

describe("isQualifyingDouble", () => {
  it("is true only for multiplier 2 (includes bullseye)", () => {
    expect(isQualifyingDouble(2)).toBe(true);
    expect(isQualifyingDouble(1)).toBe(false);
    expect(isQualifyingDouble(3)).toBe(false);
  });
});

describe("isBustThrow", () => {
  it("busts on going below zero, double-out or not", () => {
    expect(isBustThrow(20, 25, true, false)).toBe(true);
    expect(isBustThrow(20, 25, false, false)).toBe(true);
  });

  it("landing on exactly 1 busts under double-out", () => {
    expect(isBustThrow(21, 20, true, false)).toBe(true);
  });

  it("landing on exactly 1 is legal under single-out", () => {
    expect(isBustThrow(21, 20, false, false)).toBe(false);
  });

  it("checking out without a double busts under double-out", () => {
    expect(isBustThrow(20, 20, true, false)).toBe(true);
  });

  it("checking out on a qualifying double is never a bust", () => {
    expect(isBustThrow(20, 20, true, true)).toBe(false);
  });

  it("checking out without a double is fine under single-out", () => {
    expect(isBustThrow(20, 20, false, false)).toBe(false);
  });

  it("a normal scoring dart that doesn't finish is never a bust", () => {
    expect(isBustThrow(100, 60, true, false)).toBe(false);
    expect(isBustThrow(100, 60, false, false)).toBe(false);
  });
});
