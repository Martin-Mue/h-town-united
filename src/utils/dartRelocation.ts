import { KNOWN_DART_RADIUS } from "./newDartSelection";

/** A known dart counts as found again when a hit lies this close to it (frame fraction, about 7 mm). */
export const RELOCATE_REFOUND_RADIUS = 0.015;
/** A hit further away than this (about 40 mm) is never the same dart. */
export const RELOCATE_MAX_DISTANCE = 0.09;
/** Only a confident hit can take a known dart's place. */
export const RELOCATE_MIN_SCORE = 0.6;
/** How close around the old tip the picture is compared with the empty board (frame fraction, about 9 mm). */
export const OLD_SPOT_RADIUS = 0.02;
/** From this share of changed cells the old spot still holds something: the dart is still there. */
export const OLD_SPOT_OCCUPIED_SHARE = 0.5;

interface Spot {
  x?: number;
  y?: number;
}

export interface RelocationContext {
  /** A hand is in the picture (a large part of it changed): what the model finds then is not to be trusted. */
  handInPicture: boolean;
  /** The visit can still take another dart, so a confident hit next to a known dart may be a new one. */
  slotsLeft: number;
  /** Share of changed cells around a point, compared with the empty board. Null when there is no empty-board picture. */
  changedVsEmptyAt: ((x: number, y: number, radius: number) => number) | null;
}

const distance = (a: Spot, b: Spot) => Math.hypot((a.x ?? 9) - (b.x ?? -9), (a.y ?? 9) - (b.y ?? -9));

/**
 * A dart taken at its first, blurred look can sit tens of millimetres off from where it rests. When a later look no
 * longer finds it where it was put but finds a confident hit close by that no other dart explains, that hit is the
 * same dart and the dart moves there.
 *
 * The same picture also arises when a SECOND dart lands next to the first and hides its tip. Moving the first dart
 * onto it would give it the second dart's score and lose the second dart for the visit. So nothing is moved while a
 * hand is in the picture, and nothing is moved when the old spot still holds something although the visit has room
 * for another dart.
 *
 * @returns for each known dart the hit it should move to, or null to leave it where it is.
 */
export function relocationTargets<K extends Spot, H extends Spot & { confidence: number }>(
  known: K[],
  movable: (dart: K) => boolean,
  hits: H[],
  context: RelocationContext,
): (H | null)[] {
  if (context.handInPicture) return known.map(() => null);
  return known.map((k) => {
    if (!movable(k) || typeof k.x !== "number" || typeof k.y !== "number") return null;
    if (hits.some((h) => distance(h, k) < RELOCATE_REFOUND_RADIUS)) return null;
    const hit = hits
      .filter((h) => h.confidence >= RELOCATE_MIN_SCORE && distance(h, k) < RELOCATE_MAX_DISTANCE)
      .filter((h) => !known.some((o) => o !== k && typeof o.x === "number" && typeof o.y === "number" && distance(h, o) < KNOWN_DART_RADIUS))
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (!hit) return null;
    const separateSpot = distance(hit, k) >= KNOWN_DART_RADIUS;
    const oldSpotStillHoldsADart =
      !!context.changedVsEmptyAt && context.changedVsEmptyAt(k.x, k.y, OLD_SPOT_RADIUS) >= OLD_SPOT_OCCUPIED_SHARE;
    if (context.slotsLeft > 0 && separateSpot && oldSpotStillHoldsADart) return null;
    return hit;
  });
}
