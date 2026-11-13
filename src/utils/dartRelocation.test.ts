import { describe, it, expect } from "vitest";
import { relocationTargets } from "./dartRelocation";

const known = [{ x: 0.5, y: 0.5 }];
const always = () => true;
const calm = { handInPicture: false, slotsLeft: 2, changedVsEmptyAt: null };

describe("relocationTargets", () => {
  it("moves a dart to a confident hit close by when it is no longer found on its spot", () => {
    const hit = { x: 0.55, y: 0.5, confidence: 0.89 };
    expect(relocationTargets(known, always, [hit], calm)).toEqual([hit]);
  });

  it("leaves a dart that is found again on its spot", () => {
    const hits = [{ x: 0.505, y: 0.5, confidence: 0.8 }, { x: 0.56, y: 0.5, confidence: 0.9 }];
    expect(relocationTargets(known, always, hits, calm)).toEqual([null]);
  });

  it("ignores weak hits and hits too far away", () => {
    expect(relocationTargets(known, always, [{ x: 0.55, y: 0.5, confidence: 0.4 }], calm)).toEqual([null]);
    expect(relocationTargets(known, always, [{ x: 0.7, y: 0.5, confidence: 0.9 }], calm)).toEqual([null]);
  });

  it("does not hand one dart the hit that belongs to another known dart", () => {
    const two = [{ x: 0.5, y: 0.5 }, { x: 0.56, y: 0.5 }];
    const hits = [{ x: 0.562, y: 0.5, confidence: 0.9 }];
    expect(relocationTargets(two, always, hits, calm)).toEqual([null, null]);
  });

  it("moves nothing while a hand is in the picture", () => {
    const hit = { x: 0.55, y: 0.5, confidence: 0.89 };
    expect(relocationTargets(known, always, [hit], { ...calm, handInPicture: true })).toEqual([null]);
  });

  it("keeps the first dart when its spot still holds something: the hit is a second dart", () => {
    const hit = { x: 0.55, y: 0.5, confidence: 0.89 };
    const occupied = { ...calm, changedVsEmptyAt: () => 0.8 };
    expect(relocationTargets(known, always, [hit], occupied)).toEqual([null]);
  });

  it("still moves the dart when its old spot looks like the empty board again", () => {
    const hit = { x: 0.55, y: 0.5, confidence: 0.89 };
    const empty = { ...calm, changedVsEmptyAt: () => 0.1 };
    expect(relocationTargets(known, always, [hit], empty)).toEqual([hit]);
  });

  it("moves the dart when the visit is full: no further dart can have landed", () => {
    const hit = { x: 0.55, y: 0.5, confidence: 0.89 };
    const full = { handInPicture: false, slotsLeft: 0, changedVsEmptyAt: () => 0.8 };
    expect(relocationTargets(known, always, [hit], full)).toEqual([hit]);
  });

  it("allows a small shift even on an occupied spot (it is the same dart)", () => {
    const hit = { x: 0.52, y: 0.5, confidence: 0.89 };
    const occupied = { ...calm, changedVsEmptyAt: () => 0.8 };
    expect(relocationTargets(known, always, [hit], occupied)).toEqual([hit]);
  });

  it("leaves darts the player placed by hand", () => {
    const hit = { x: 0.55, y: 0.5, confidence: 0.89 };
    expect(relocationTargets(known, () => false, [hit], calm)).toEqual([null]);
  });
});
