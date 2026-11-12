import { describe, it, expect } from "vitest";
import {
  activeStatsPeriod, averageChange, averagesPerPlayDay, barHeightPercents, filterStateForPeriod,
  isInWindow, localDayKey, meanOfGameAverages, previousWindowFor, type GameAverageSample,
} from "./statsHeadline";

const DAY = 86_400_000;
const at = (y: number, m: number, d: number, h = 20) => new Date(y, m - 1, d, h).getTime();
const sample = (gameId: string, playedAt: number, average: number): GameAverageSample => ({ gameId, playedAt, average });

describe("period switch <-> filter state", () => {
  it("maps every period to the page's existing filters and back", () => {
    for (const period of ["week", "month", "season", "all"] as const) {
      const { filterTime, filterYear } = filterStateForPeriod(period, 2026);
      expect(activeStatsPeriod(filterTime, filterYear, 2026)).toBe(period);
    }
    expect(filterStateForPeriod("season", 2026)).toEqual({ filterTime: "all", filterYear: "2026" });
  });

  it("presses no button for filter combinations no shortcut stands for", () => {
    expect(activeStatsPeriod("today", "all", 2026)).toBeNull();
    expect(activeStatsPeriod("all", "2025", 2026)).toBeNull();
    expect(activeStatsPeriod("week", "2026", 2026)).toBeNull();
  });
});

describe("previousWindowFor", () => {
  const now = at(2026, 11, 12);

  it("compares 7 and 30 days with the equally long stretch right before", () => {
    expect(previousWindowFor("week", "all", now)).toEqual({ kind: "week", window: { start: now - 14 * DAY, end: now - 7 * DAY } });
    expect(previousWindowFor("month", "all", now)).toEqual({ kind: "month", window: { start: now - 60 * DAY, end: now - 30 * DAY } });
  });

  it("compares a season with the whole previous calendar year", () => {
    const prev = previousWindowFor("all", "2026", now);
    expect(prev?.kind).toBe("season");
    expect(isInWindow(at(2025, 1, 1, 0), prev!.window)).toBe(true);
    expect(isInWindow(at(2025, 12, 31, 23), prev!.window)).toBe(true);
    expect(isInWindow(at(2026, 1, 1, 0), prev!.window)).toBe(false);
  });

  it("has no comparison for all time, today, 12 months or mixed filters", () => {
    expect(previousWindowFor("all", "all", now)).toBeNull();
    expect(previousWindowFor("today", "all", now)).toBeNull();
    expect(previousWindowFor("year", "all", now)).toBeNull();
    expect(previousWindowFor("week", "2026", now)).toBeNull();
  });
});

describe("average and change", () => {
  it("counts every game equally", () => {
    expect(meanOfGameAverages([sample("a", 0, 40), sample("b", 0, 60)])).toBe(50);
    expect(meanOfGameAverages([])).toBeNull();
  });

  it("rounds the change to one decimal and needs both periods", () => {
    expect(averageChange(52.44, 51.5)).toBe(0.9);
    expect(averageChange(48, 50.06)).toBe(-2.1);
    expect(averageChange(50, null)).toBeNull();
    expect(averageChange(null, 50)).toBeNull();
  });
});

describe("averagesPerPlayDay", () => {
  it("groups games by local day, oldest first, and keeps only the latest days", () => {
    const samples = [
      sample("g3", at(2026, 11, 10), 60),
      sample("g1", at(2026, 11, 8, 19), 40),
      sample("g2", at(2026, 11, 8, 21), 50),
      sample("g4", at(2026, 11, 11), 55),
    ];
    const days = averagesPerPlayDay(samples);
    expect(days.map((d) => d.dayKey)).toEqual(["2026-11-08", "2026-11-10", "2026-11-11"]);
    expect(days[0]).toMatchObject({ average: 45, games: 2, firstPlayedAt: at(2026, 11, 8, 19) });
    expect(averagesPerPlayDay(samples, 2).map((d) => d.dayKey)).toEqual(["2026-11-10", "2026-11-11"]);
  });

  it("formats day keys with zero padding", () => {
    expect(localDayKey(at(2026, 3, 5))).toBe("2026-03-05");
  });
});

describe("barHeightPercents", () => {
  it("puts the highest day at full height and keeps the lowest visible", () => {
    const h = barHeightPercents([48, 52, 56]);
    expect(h[2]).toBe(100);
    expect(h[0]).toBeGreaterThanOrEqual(12);
    expect(h[0]).toBeLessThan(h[1]);
  });

  it("draws equal values at full height and handles no data", () => {
    expect(barHeightPercents([50, 50])).toEqual([100, 100]);
    expect(barHeightPercents([])).toEqual([]);
  });
});
