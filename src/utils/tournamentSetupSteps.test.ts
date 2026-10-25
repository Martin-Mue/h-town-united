import { describe, expect, it } from "vitest";
import { allSetupIssues, firstStepWithIssue, setupStepIssues, type SetupState } from "./tournamentSetupSteps";

const ready: SetupState = { mode: "ko", playerCount: 8, doublesEnabled: false, unpairedSingles: 0, maxParticipants: 64 };

describe("tournament setup steps", () => {
  it("lets the first two steps go on without any input", () => {
    const empty = { ...ready, playerCount: 0 };
    expect(setupStepIssues("basics", empty)).toEqual([]);
    expect(setupStepIssues("format", empty)).toEqual([]);
  });

  it("needs two players before the players step is done", () => {
    expect(setupStepIssues("players", { ...ready, playerCount: 1 })).toEqual(["tournament.issueNeedTwoPlayers"]);
    expect(setupStepIssues("players", { ...ready, playerCount: 2 })).toEqual([]);
  });

  it("flags more players than the plan allows", () => {
    expect(setupStepIssues("players", { ...ready, playerCount: 9, maxParticipants: 8 })).toEqual(["tournament.issueTooManyPlayers"]);
  });

  it("flags unpaired entries only in a doubles tournament", () => {
    expect(setupStepIssues("players", { ...ready, unpairedSingles: 3 })).toEqual([]);
    expect(setupStepIssues("players", { ...ready, doublesEnabled: true, unpairedSingles: 3 })).toEqual(["tournament.issueDoublesUnpaired"]);
  });

  it("lists every problem once for the review step and finds the step to go back to", () => {
    const broken = { ...ready, playerCount: 1, doublesEnabled: true, unpairedSingles: 1 };
    expect(allSetupIssues(broken)).toEqual(["tournament.issueNeedTwoPlayers", "tournament.issueDoublesUnpaired"]);
    expect(firstStepWithIssue(broken)).toBe("players");
    expect(firstStepWithIssue(ready)).toBeNull();
  });
});
