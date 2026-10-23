import type { DartThrow } from "@/types/game";

/** Darts in one visit — a busted visit always counts as a full one. */
const DARTS_PER_VISIT = 3;

/**
 * How a busted visit is written into a leg's throw history.
 *
 * A bust scores nothing, but the darts were thrown: in every official statistic the visit counts as three
 * darts at zero points, and the player is simply one visit further into the leg. Dropping the visit (what
 * the app used to do) made it vanish from the round count, inflated the average and let the round cap
 * miss the round. So the darts stay, scored as 0 and marked `bust`, padded with misses up to a full visit
 * (the unthrown rest of the visit counts too). The remaining score is untouched — it is tracked separately,
 * and 0 points keep every running total in the stats exact.
 */
export const bustVisitThrows = (thrown: Pick<DartThrow, "baseValue" | "multiplier" | "boardU" | "boardV">[]): DartThrow[] => {
  const visit: DartThrow[] = thrown.slice(0, DARTS_PER_VISIT).map((d) => ({
    baseValue: d.baseValue,
    multiplier: d.multiplier,
    points: 0,
    boardU: d.boardU,
    boardV: d.boardV,
    bust: true,
  }));
  while (visit.length < DARTS_PER_VISIT) visit.push({ baseValue: 0, multiplier: 1, points: 0, bust: true });
  return visit;
};
