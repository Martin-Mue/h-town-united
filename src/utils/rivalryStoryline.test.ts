import { describe, it, expect } from "vitest";
import { buildRivalryStoryline, type RivalryMeeting } from "./rivalryStoryline";

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const meeting = (aWon: boolean, d: number): RivalryMeeting => ({ aWon, playedAt: daysAgo(d) });

describe("buildRivalryStoryline", () => {
  it("returns null for a first-ever meeting (no history yet)", () => {
    expect(buildRivalryStoryline([], "Martin", "Kevin")).toBeNull();
  });

  it("frames a single prior meeting as revenge for the loser", () => {
    const text = buildRivalryStoryline([meeting(true, 5)], "Martin", "Kevin");
    expect(text).toContain("Martin gewann");
    expect(text).toContain("Kevin will zurückschlagen");
  });

  it("calls out a 3+ win streak with the correct winner", () => {
    const meetings = [meeting(false, 10), meeting(true, 3), meeting(true, 2), meeting(true, 1)];
    const text = buildRivalryStoryline(meetings, "Martin", "Kevin")!;
    expect(text).toContain("Martin");
    expect(text).toContain("3");
    expect(text).toContain("in Folge");
  });

  it("calls out a 2-win streak distinctly from a 3+ streak", () => {
    const meetings = [meeting(false, 3), meeting(false, 2)];
    const text = buildRivalryStoryline(meetings, "Martin", "Kevin")!;
    expect(text).toContain("Kevin");
    expect(text).toContain("letzten beiden");
    expect(text).not.toContain("in Folge");
  });

  it("prioritizes an active 2-streak over a close overall record", () => {
    // Overall 3:2 (close enough to qualify for the "ausgeglichen" framing on its own), but the
    // most recent 2 meetings were both won by the same player — that more recent, more dramatic
    // fact should win over the plain "close rivalry" framing.
    const meetings = [meeting(false, 40), meeting(true, 30), meeting(false, 20), meeting(true, 10), meeting(true, 1)];
    const text = buildRivalryStoryline(meetings, "Martin", "Kevin")!;
    expect(text).toContain("letzten beiden");
    expect(text).not.toContain("ausgeglichen");
  });

  it("calls out a perfectly even rivalry once the streak itself is broken", () => {
    const meetings = [meeting(true, 40), meeting(false, 30), meeting(true, 20), meeting(false, 10)];
    const text = buildRivalryStoryline(meetings, "Martin", "Kevin")!;
    expect(text).toContain("ausgeglichen");
    expect(text).toContain("2:2");
  });

  it("does not call a short history (under 4 meetings) an even rivalry", () => {
    const meetings = [meeting(true, 20), meeting(false, 10)];
    const text = buildRivalryStoryline(meetings, "Martin", "Kevin")!;
    expect(text).not.toContain("ausgeglichen");
  });
});
