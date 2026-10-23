/**
 * Helpers for correcting a detected dart without pixel-exact tapping.
 *
 * Almost every wrong reading is off by one wire — the neighbouring segment, or single/double/treble
 * of the same segment — so instead of asking the player to hit the tip position exactly, the review
 * offers those few alternatives as chips. Choosing one also moves the dart's position into the chosen
 * field (nearest sensible point), so the stored position never contradicts the stored score; such a
 * dart is flagged `snapped` because its position is a field centre, not a measured tip.
 */

import { RING, SEGMENTS_CLOCKWISE } from "./dartboardGeometry";

export interface ScoreChoice {
  /** 0 = miss, 25 = bull, 1-20 = segment. */
  baseValue: number;
  multiplier: 1 | 2 | 3;
}

export const choiceLabel = (c: ScoreChoice): string => {
  if (c.baseValue === 0) return "0";
  if (c.baseValue === 25) return c.multiplier === 2 ? "Bull" : "25";
  return `${c.multiplier === 3 ? "T" : c.multiplier === 2 ? "D" : ""}${c.baseValue}`;
};

const idxOf = (base: number) => SEGMENTS_CLOCKWISE.indexOf(base);
const wrap = (i: number) => ((i % 20) + 20) % 20;

/** The segments around the given one on the board, nearest first on each side: [-2, -1, self, +1, +2]. */
export const neighbourSegments = (baseValue: number): number[] => {
  const i = idxOf(baseValue);
  if (i < 0) return [];
  return [-2, -1, 0, 1, 2].map((d) => SEGMENTS_CLOCKWISE[wrap(i + d)]);
};

/** Boundary radii (board-canonical) of the three bands a segment's score can come from. */
const BANDS = {
  innerSingle: { min: RING.bullOuter, max: RING.trebleInner },
  treble: { min: RING.trebleInner, max: RING.trebleOuter },
  outerSingle: { min: RING.trebleOuter, max: RING.doubleInner },
  double: { min: RING.doubleInner, max: RING.doubleOuter },
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * A board-canonical point (x right, y down, radius 1 = double edge) that scores exactly `choice`,
 * as close as possible to `near` (the dart's current canonical position, if known).
 */
export const canonicalPointForChoice = (
  choice: ScoreChoice,
  near: { x: number; y: number } | null,
): { x: number; y: number } => {
  const nearRadius = near ? Math.hypot(near.x, near.y) : 0.8;
  const nearAngle = near ? Math.atan2(near.x, -near.y) : 0; // 0 = top, clockwise
  const at = (r: number, angle: number) => ({ x: r * Math.sin(angle), y: -r * Math.cos(angle) });

  if (choice.baseValue === 0) return at(RING.doubleOuter * 1.12, nearAngle);
  if (choice.baseValue === 25) {
    return choice.multiplier === 2 ? { x: 0, y: 0 } : at((RING.bullInner + RING.bullOuter) / 2, nearAngle);
  }
  const idx = idxOf(choice.baseValue);
  const centre = (idx * 18 * Math.PI) / 180;
  // Keep the dart's own angle if it is already inside this segment (a pure ring change), otherwise
  // move to the segment centre.
  const deg = ((nearAngle * 180) / Math.PI + 360) % 360;
  const segDeg = idx * 18;
  const diff = Math.abs(((deg - segDeg + 540) % 360) - 180);
  const angle = diff <= 7 ? nearAngle : centre;

  let r: number;
  if (choice.multiplier === 3) r = (BANDS.treble.min + BANDS.treble.max) / 2;
  else if (choice.multiplier === 2) r = (BANDS.double.min + BANDS.double.max) / 2;
  else if (nearRadius >= BANDS.treble.max) r = clamp(nearRadius, BANDS.outerSingle.min + 0.02, BANDS.outerSingle.max - 0.02);
  else if (nearRadius <= BANDS.treble.min) r = clamp(nearRadius, BANDS.innerSingle.min + 0.03, BANDS.innerSingle.max - 0.03);
  else r = (BANDS.outerSingle.min + BANDS.outerSingle.max) / 2;
  return at(r, angle);
};
