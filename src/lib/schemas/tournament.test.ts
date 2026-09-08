import { describe, it, expect, vi, afterEach } from "vitest";
import { parsePlayers, parseBracket, parseRoundConfigs, parseAttendance, parsePrestartViews } from "./tournament";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parsePlayers", () => {
  it("passes through a valid string array", () => {
    expect(parsePlayers(["Anna", "Ben"])).toEqual(["Anna", "Ben"]);
  });

  it("returns [] for null/undefined without logging", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parsePlayers(null)).toEqual([]);
    expect(parsePlayers(undefined)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns [] and logs for a malformed value", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parsePlayers({ not: "an array" })).toEqual([]);
    expect(parsePlayers([1, 2, 3])).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("parseBracket", () => {
  it("accepts a valid KO bracket (Match[])", () => {
    const raw = [
      { id: "r1-0", round: 1, position: 0, player1: "A", player2: "B", winner: "A" },
      { id: "r2-0", round: 2, position: 0 },
    ];
    expect(parseBracket(raw)).toEqual(raw);
  });

  it("accepts a valid round-robin bracket (RoundRobinMatch[])", () => {
    const raw = [
      { id: "m1", player1: "A", player2: "B", played: true, winner: "A" },
      { id: "m2", player1: "A", player2: "C", played: false },
    ];
    expect(parseBracket(raw)).toEqual(raw);
  });

  it("drops only the malformed entries, keeping the valid ones", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = [
      { id: "m1", player1: "A", player2: "B", played: true },
      { id: "m2" }, // neither a valid Match (missing round/position) nor RoundRobinMatch (missing played/player1/player2)
      { id: "m3", player1: "C", player2: "D", played: false },
    ];
    const result = parseBracket(raw);
    expect(result).toEqual([raw[0], raw[2]]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns [] for null/undefined, and [] (logged) for a non-array", () => {
    expect(parseBracket(null)).toEqual([]);
    expect(parseBracket(undefined)).toEqual([]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseBracket("not an array")).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("parseRoundConfigs", () => {
  it("passes through valid round configs", () => {
    const raw = [{ mode: "501", bestOf: 3 }, { mode: "Cricket", bestOf: 1 }];
    expect(parseRoundConfigs(raw)).toEqual(raw);
  });

  it("returns [] and logs for malformed entries", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseRoundConfigs([{ mode: "501" }])).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("parseAttendance", () => {
  it("passes through a valid name->boolean map", () => {
    const raw = { Anna: true, Ben: false };
    expect(parseAttendance(raw)).toEqual(raw);
  });

  it("returns {} for null/undefined, and {} (logged) for a malformed value", () => {
    expect(parseAttendance(null)).toEqual({});
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseAttendance({ Anna: "yes" })).toEqual({});
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("parsePrestartViews", () => {
  const fallback = ["waiting", "format", "qr"];

  it("passes through a valid slot list", () => {
    expect(parsePrestartViews(["boards", "bracket"], fallback)).toEqual(["boards", "bracket"]);
  });

  it("drops unknown slots but keeps the known ones", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parsePrestartViews(["boards", "not-a-real-slot"], fallback)).toEqual(["boards"]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("falls back when nothing valid remains", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parsePrestartViews(["nonsense"], fallback)).toEqual(fallback);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("falls back for null/undefined without logging", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parsePrestartViews(null, fallback)).toEqual(fallback);
    expect(parsePrestartViews(undefined, fallback)).toEqual(fallback);
    expect(spy).not.toHaveBeenCalled();
  });
});
