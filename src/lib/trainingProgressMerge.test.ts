import { describe, it, expect } from "vitest";
import { mergeTrainingValue, isTrainingKey, HISTORY_LIMIT } from "./trainingProgressMerge";

describe("mergeTrainingValue", () => {
  it("keeps the better record, higher or lower is better", () => {
    const a = { value: 82, higherIsBetter: true, label: "82%", achievedAt: "2026-11-01" };
    const b = { value: 75, higherIsBetter: true, label: "75%", achievedAt: "2026-11-10" };
    expect(mergeTrainingValue("training-record-bobs-27", a, b)).toBe(a);
    const fewer = { value: 21, higherIsBetter: false, label: "21", achievedAt: "2026-11-01" };
    const more = { value: 30, higherIsBetter: false, label: "30", achievedAt: "2026-10-01" };
    expect(mergeTrainingValue("training-record-atc", more, fewer)).toBe(fewer);
  });

  it("keeps the earlier one of two equal records", () => {
    const early = { value: 50, higherIsBetter: true, achievedAt: "2026-10-01" };
    const late = { value: 50, higherIsBetter: true, achievedAt: "2026-11-01" };
    expect(mergeTrainingValue("training-record-x", late, early)).toBe(early);
  });

  it("joins both attempt lists in time order, each attempt once, the newest kept", () => {
    const local = [{ value: 1, achievedAt: "2026-11-01" }, { value: 3, achievedAt: "2026-11-03" }];
    const remote = [{ value: 2, achievedAt: "2026-11-02" }, { value: 3, achievedAt: "2026-11-03" }];
    expect(mergeTrainingValue("training-history-x", local, remote)).toEqual([
      { value: 1, achievedAt: "2026-11-01" }, { value: 2, achievedAt: "2026-11-02" }, { value: 3, achievedAt: "2026-11-03" },
    ]);
    const many = Array.from({ length: 20 }, (_, i) => ({ value: i, achievedAt: `2026-11-${String(i + 1).padStart(2, "0")}` }));
    const merged = mergeTrainingValue("training-history-x", many, []) as unknown[];
    expect(merged.length).toBe(HISTORY_LIMIT);
  });

  it("takes the streak practised last and the longest best", () => {
    const phone = { current: 3, best: 3, lastDate: "2026-11-20" };
    const tablet = { current: 1, best: 9, lastDate: "2026-11-24" };
    expect(mergeTrainingValue("training-streak", phone, tablet)).toEqual({ current: 1, best: 9, lastDate: "2026-11-24" });
  });

  it("takes whichever side exists", () => {
    expect(mergeTrainingValue("training-streak", null, { current: 1, best: 1, lastDate: "2026-11-24" })).toEqual({ current: 1, best: 1, lastDate: "2026-11-24" });
    expect(mergeTrainingValue("training-record-x", { value: 1, higherIsBetter: true }, undefined)).toEqual({ value: 1, higherIsBetter: true });
  });
});

describe("isTrainingKey", () => {
  it("knows records, history and the streak, nothing else", () => {
    expect(isTrainingKey("training-record-target-grind:3x20:10")).toBe(true);
    expect(isTrainingKey("training-history-bobs-27")).toBe(true);
    expect(isTrainingKey("training-streak")).toBe(true);
    expect(isTrainingKey("training-legacy-claimed-by")).toBe(false);
    expect(isTrainingKey("dartcam-bulloff-pref")).toBe(false);
  });
});
