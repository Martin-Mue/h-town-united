/**
 * The tournament setup is a short sequence of steps. This is the one place that says what each step still lacks
 * before "Weiter" is allowed — the wizard shows these as hints and the final step re-checks them all.
 */
export type SetupStepKey = "basics" | "format" | "players" | "review";

export const SETUP_STEP_ORDER: readonly SetupStepKey[] = ["basics", "format", "players", "review"];

export interface SetupState {
  mode: string;
  playerCount: number;
  /** Doubles tournament: every entry has to be a team of two. */
  doublesEnabled: boolean;
  unpairedSingles: number;
  maxParticipants: number;
}

/** Translation keys of the problems that keep a step from being finished. Empty = ready to go on. */
export function setupStepIssues(step: SetupStepKey, state: SetupState): string[] {
  const issues: string[] = [];
  if (step === "players" || step === "review") {
    if (state.playerCount < 2) issues.push("tournament.issueNeedTwoPlayers");
    if (state.playerCount > state.maxParticipants) issues.push("tournament.issueTooManyPlayers");
    if (state.doublesEnabled && state.unpairedSingles > 0) issues.push("tournament.issueDoublesUnpaired");
  }
  return issues;
}

/** Every problem of the whole setup, in step order (what the last step lists before the start button). */
export function allSetupIssues(state: SetupState): string[] {
  const seen = new Set<string>();
  for (const step of SETUP_STEP_ORDER) for (const key of setupStepIssues(step, state)) seen.add(key);
  return [...seen];
}

/** The first step that still has an issue, so a click on "Starten" can send the person to the right place. */
export function firstStepWithIssue(state: SetupState): SetupStepKey | null {
  return SETUP_STEP_ORDER.find((step) => step !== "review" && setupStepIssues(step, state).length > 0) ?? null;
}
