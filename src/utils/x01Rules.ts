/** A dart counts as a "double" for double-in/double-out purposes whenever its multiplier is
 *  2 — that's true for an outer double ring hit and for bullseye alike (bullseye is encoded
 *  as baseValue 25, multiplier 2), so no separate bullseye case is needed. */
export function isQualifyingDouble(multiplier: number): boolean {
  return multiplier === 2;
}

/**
 * Points scored by one dart. baseValue 25 + multiplier 3 ("triple bull") isn't a real dartboard
 * outcome — there's no triple ring in the bull — so it scores 0 rather than the nonsensical 75;
 * this only matters as a defensive case for bad detection data, real throws never produce it.
 *
 * This formula was independently copy-pasted at every dart-scoring call site (manual X01/Cricket
 * entry, camera-detected rounds, the bot player) — already-observed drift: one camera-path copy
 * (LiveCamera.tsx) used a differently-shaped formula that omitted this triple-bull case entirely.
 * Shared here (alongside isQualifyingDouble/isBustThrow, which this file already exists to keep
 * in sync across those exact same call sites) instead of reimplemented again next time.
 */
export function pointsFor(baseValue: number, multiplier: number): number {
  return baseValue === 25 && multiplier === 3 ? 0 : baseValue * multiplier;
}

/**
 * Short display label for one dart ("D20", "T20", "Bull 25", "Bull 50", "Miss") — independently
 * reworded at every display site (Game.tsx used "M"/"25"/"BULL"; LiveCamera.tsx used "Miss"/
 * "Bull 25"/"Bull 50"; ThrowClipDialog.tsx used "Miss"/"25"/"Bull 50", inconsistent even with
 * itself, a single-25 hit reading as just "25" while a bullseye correctly said "Bull 50"). Settled
 * on LiveCamera.tsx's wording as canonical (unambiguous either way a dart can land in the bull,
 * and matches DartScoreInput's own "Miss" button label) rather than picking arbitrarily — this
 * also means a manually-entered dart and a camera-detected one now read identically everywhere.
 * Takes a minimal structural shape (not DartThrow or DetectedDart specifically) since both already
 * satisfy it and neither type belongs to this module.
 */
export function dartLabel(d: { baseValue: number; multiplier: number }): string {
  if (d.baseValue === 0) return "Miss";
  if (d.baseValue === 25) return d.multiplier === 2 ? "Bull 50" : "Bull 25";
  const prefix = d.multiplier === 2 ? "D" : d.multiplier === 3 ? "T" : "";
  return `${prefix}${d.baseValue}`;
}

/** Emoji+word for a highlight-clip kind — shared between Statistics.tsx's compact history badge
 *  and ThrowClipDialog.tsx's live celebration banner, which previously worded this independently
 *  (mismatched punctuation, and a generic "Ton+" where the live banner actually has the real point
 *  total available and showed it). The 180/checkout wording is now identical either way; ton_plus
 *  still takes an optional `points` for the live-banner case, where showing the actual number is
 *  more useful than a generic label — a deliberate difference, not drift. */
export function highlightKindLabel(kind: string, points?: number): string {
  if (kind === "180") return "🎯 180";
  if (kind === "checkout") return "🏆 Checkout";
  return points !== undefined ? `🔥 ${points} Punkte` : "🔥 Ton+";
}

/**
 * Standard X01 bust rule, shared by manual entry, camera-detected scoring, and the bot player
 * so the three can never drift out of sync again:
 *  - going below zero always busts
 *  - landing on exactly 1 only busts under double-out (single-out can finish a 1 next visit)
 *  - landing on exactly 0 without finishing on a qualifying double busts, but only when
 *    double-out is actually required
 */
export function isBustThrow(remaining: number, points: number, doubleOut: boolean, isDouble: boolean): boolean {
  const newRemaining = remaining - points;
  if (newRemaining < 0) return true;
  if (newRemaining === 1 && doubleOut) return true;
  if (newRemaining === 0 && doubleOut && !isDouble) return true;
  return false;
}

export interface VisitDart {
  points: number;
  isDouble: boolean;
}

export type VisitOutcome =
  | { kind: "continue" }
  | { kind: "bust" }
  | { kind: "checkout" }
  /** The visit total lands exactly on a finish, double-out is required, and the darts include a
   *  genuine mix of doubles and non-doubles — see the doc comment below for why this specific
   *  case can't be resolved automatically. `doubleIndexes` are the indexes (into the `darts` array
   *  passed in) of the darts that COULD legally have been the finisher, for a caller to offer as
   *  choices. */
  | { kind: "ambiguous"; doubleIndexes: number[] };

/**
 * Resolves one whole visit's worth of darts against the standard X01 bust/checkout rules
 * (isBustThrow above) WITHOUT assuming `darts`' array order is the true throw order.
 *
 * isBustThrow was designed to be evaluated one dart at a time, in real throw order, as manual
 * entry and the bot player already do. Camera-detected rounds only ever see the board ONCE,
 * after all darts in the visit are already stuck in (a single before/after frame comparison, or
 * one model pass over the final image) — there is no way to recover which dart was thrown
 * 1st/2nd/3rd from that, so feeding isBustThrow the darts in whatever order the detector happened
 * to return them (confidence, blob size, model output order — never throw order) can flip a
 * genuine match-winning checkout into a wrongly-declared bust, or a genuine bust into a wrongly-
 * awarded checkout, purely depending on incidental array position. This is what a 2026-08-17
 * field report described as "checkouts and busts disregarded by camera detection".
 *
 * This resolves the visit holistically instead, using only order-INVARIANT facts:
 *  - Dart points are never negative, so the running total after all N darts is the same
 *    regardless of what order they're summed in, and — since remaining can only decrease — no
 *    prefix can bust (go negative) or wrongly land on a total the FULL set doesn't also reach.
 *    That makes "does the total overshoot `remaining`, or land exactly on `remaining - 1` under
 *    double-out (landing on 1 always busts, whichever dart did it)" safe to decide from the total
 *    alone, with no per-dart order needed.
 *  - If the total lands short of `remaining`, nothing bust/checkout-relevant happened — order
 *    can't matter since no dart, in any arrangement, individually reaches `remaining` either.
 *  - If the total lands exactly on `remaining` under double-out, a real checkout requires
 *    specifically the LAST dart to be a qualifying double. Whichever dart was actually last is
 *    exactly the information a single end-of-visit frame can't recover. When every dart in the
 *    visit is a double, it doesn't matter which one was last — always a checkout. When none of
 *    them are, no arrangement can legally finish — always a bust. Otherwise (a genuine mix), BOTH
 *    a checkout (double-last) and a bust (non-double-last) are reachable via some arrangement of
 *    the same known values, and nothing in the unordered set can tell them apart — reported back
 *    as "ambiguous" rather than silently guessing, so the caller can ask which dart finished it.
 */
export function resolveX01Visit(remaining: number, doubleOut: boolean, darts: VisitDart[]): VisitOutcome {
  const total = darts.reduce((s, d) => s + d.points, 0);
  if (total > remaining) return { kind: "bust" };
  if (doubleOut && total === remaining - 1) return { kind: "bust" };
  if (total < remaining) return { kind: "continue" };
  // total === remaining: every dart in the visit is accounted for by the sum, so this is a
  // genuine finish attempt.
  if (!doubleOut) return { kind: "checkout" };
  const doubleIndexes = darts.reduce<number[]>((acc, d, i) => (d.isDouble ? [...acc, i] : acc), []);
  if (doubleIndexes.length === 0) return { kind: "bust" }; // no double anywhere -> can't have legally finished
  if (doubleIndexes.length === darts.length) return { kind: "checkout" }; // every dart is a double -> checkout no matter which was actually last
  return { kind: "ambiguous", doubleIndexes };
}
