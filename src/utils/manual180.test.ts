import { describe, it, expect } from "vitest";
import { combine180Breakdown, manualEntriesApplicable, type Manual180Entry } from "./manual180";

describe("combine180Breakdown", () => {
  it("adds app-tracked and manual counts for a year that has both", () => {
    const result = combine180Breakdown({ 2024: 5 }, [{ player_id: "p1", year: 2024, count: 3 }]);
    expect(result).toEqual([{ year: 2024, appTracked: 5, manual: 3, total: 8 }]);
  });

  it("includes a year with only an app-tracked count", () => {
    const result = combine180Breakdown({ 2024: 5 }, []);
    expect(result).toEqual([{ year: 2024, appTracked: 5, manual: 0, total: 5 }]);
  });

  it("includes a year with only a manual entry", () => {
    const result = combine180Breakdown({}, [{ player_id: "p1", year: 2018, count: 12 }]);
    expect(result).toEqual([{ year: 2018, appTracked: 0, manual: 12, total: 12 }]);
  });

  it("sorts newest year first", () => {
    const entries: Manual180Entry[] = [
      { player_id: "p1", year: 2015, count: 1 },
      { player_id: "p1", year: 2022, count: 2 },
      { player_id: "p1", year: 2019, count: 3 },
    ];
    const result = combine180Breakdown({}, entries);
    expect(result.map((r) => r.year)).toEqual([2022, 2019, 2015]);
  });

  it("returns an empty breakdown when there's no data at all", () => {
    expect(combine180Breakdown({}, [])).toEqual([]);
  });
});

describe("manualEntriesApplicable", () => {
  it("is true for the 'all time' filter", () => {
    expect(manualEntriesApplicable("all")).toBe(true);
  });

  it("is false for a relative window that can't be mapped to a whole year", () => {
    expect(manualEntriesApplicable("today")).toBe(false);
    expect(manualEntriesApplicable("week")).toBe(false);
    expect(manualEntriesApplicable("month")).toBe(false);
    expect(manualEntriesApplicable("year")).toBe(false);
  });
});
