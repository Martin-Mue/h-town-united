import { RING, SEGMENTS_CLOCKWISE } from "./dartboardGeometry";

export interface BoardPoint {
  /** Board-canonical coordinates: (0,0) = bull, radius 1 = outer edge of the double ring, u right, v down. */
  u: number;
  v: number;
}

/** Small deterministic pseudo-random number in [0, 1) — the same seed always gives the same spot. */
const unit = (seed: number, salt: number): number => {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Margin kept to the wires so a drawn dart never lands on a field border. */
const WIRE_MARGIN = 0.012;
const SEGMENT_HALF_WIDTH_DEG = 9;

const polar = (radius: number, angleDeg: number): BoardPoint => {
  const a = (angleDeg * Math.PI) / 180;
  return { u: radius * Math.sin(a), v: -radius * Math.cos(a) };
};

/**
 * Where to draw a dart on the simulated board when only its field is known (bot throws, hand-entered darts).
 * The spot is somewhere inside that field and always scores exactly the thrown value again; a miss lands just
 * outside the double ring. Deterministic per `seed`, so a re-render never moves a dart.
 */
export function markerPositionFor(baseValue: number, multiplier: number, seed: number): BoardPoint {
  const randomAngle = unit(seed, 1) * 360;
  if (baseValue === 0) return polar(1.1 + unit(seed, 2) * 0.06, randomAngle);
  if (baseValue === 50) return polar(unit(seed, 2) * (RING.bullInner - 0.01), randomAngle);
  if (baseValue === 25) return polar(RING.bullInner + 0.012 + unit(seed, 2) * (RING.bullOuter - RING.bullInner - 0.024), randomAngle);

  const index = SEGMENTS_CLOCKWISE.indexOf(baseValue);
  const angle = (index < 0 ? 0 : index) * 18 + (unit(seed, 3) - 0.5) * 2 * (SEGMENT_HALF_WIDTH_DEG - 3);
  const band = (inner: number, outer: number) => inner + WIRE_MARGIN + unit(seed, 2) * (outer - inner - 2 * WIRE_MARGIN);
  if (multiplier === 3) return polar(band(RING.trebleInner, RING.trebleOuter), angle);
  if (multiplier === 2) return polar(band(RING.doubleInner, RING.doubleOuter), angle);
  // a single can be the wide inner field or the outer one (they sit on either side of the treble ring)
  return unit(seed, 4) < 0.45 ? polar(band(RING.bullOuter, RING.trebleInner), angle) : polar(band(RING.trebleOuter, RING.doubleInner), angle);
}
