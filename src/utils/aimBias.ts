import { SEGMENTS_CLOCKWISE, RING } from "./dartboardGeometry";

export interface CoordDart {
  baseValue: number;
  multiplier: number;
  boardU?: number;
  boardV?: number;
}

export interface AimBiasResult {
  sampleSize: number;
  /** Board-relative units (same scale as boardU/V — 1.0 = double-ring outer edge). Positive
   *  radial = landing beyond the intended ring (too far out); positive tangential = landing
   *  clockwise of the intended wedge center. */
  avgRadialOffset: number;
  avgTangentialOffset: number;
  /** Same two numbers converted to real millimeters via the regulation double-ring-edge
   *  radius (170mm) — much more concrete to show a player than a unitless fraction. */
  radialOffsetMm: number;
  tangentialOffsetMm: number;
}

const DOUBLE_EDGE_MM = 170;
/** Below this many qualifying darts, an averaged offset is more noise than signal — say so
 *  instead of showing a number that looks confident but isn't backed by enough throws. */
const MIN_SAMPLE = 20;

function toPolar(u: number, v: number): { r: number; deg: number } {
  const r = Math.sqrt(u * u + v * v);
  const deg = ((Math.atan2(v, u) * 180) / Math.PI + 90 + 360) % 360;
  return { r, deg };
}

/** Where a dart SHOULD have landed to be dead-center of the ring it actually scored in — the
 *  reference point every offset is measured against. Bull/bullseye are deliberately excluded by
 *  the caller (see computeAimBias): they have no wedge angle, so "clockwise offset" is
 *  meaningless there, and radial-only error is a different kind of signal than wedge aim. */
function idealPointFor(baseValue: number, multiplier: number, actualR: number): { r: number; deg: number } | null {
  const wedgeIndex = SEGMENTS_CLOCKWISE.indexOf(baseValue);
  if (wedgeIndex === -1) return null;
  const deg = wedgeIndex * (360 / 20);
  let r: number;
  if (multiplier === 3) {
    r = (RING.trebleInner + RING.trebleOuter) / 2;
  } else if (multiplier === 2) {
    r = (RING.doubleInner + RING.doubleOuter) / 2;
  } else {
    // A single covers two disjoint bands (inner, between bull and treble; outer, between
    // treble and double) — pick whichever the dart's actual radius sits closer to, rather than
    // assuming one, since either is a perfectly normal single.
    const innerMid = (RING.bullOuter + RING.trebleInner) / 2;
    const outerMid = (RING.trebleOuter + RING.doubleInner) / 2;
    r = Math.abs(actualR - innerMid) <= Math.abs(actualR - outerMid) ? innerMid : outerMid;
  }
  return { r, deg };
}

/**
 * Aggregate aim-bias analysis from a player's camera-scored darts: not "which number do you
 * miss most" (needs far more samples per segment than any club has yet), but one pooled
 * question — averaged across every numbered-wedge dart regardless of which number it was,
 * do you consistently land a bit long/short of the ring you were aiming for, and a bit
 * clockwise/counterclockwise of the wedge center? That's a single statistic with a much lower
 * sample-size floor, and it's exactly the kind of thing a player can't see for themselves by
 * eyeballing a heatmap — only a manual-entry-free app with real tip coordinates even has the
 * data to answer it at all.
 *
 * Each dart's offset is measured in ITS OWN local (radial, tangential) frame — rotated to that
 * dart's specific wedge angle — before averaging, precisely so offsets from a T20 attempt and a
 * D6 attempt combine meaningfully instead of cancelling out or averaging in world coordinates
 * (which would conflate "consistently high" with "consistently clockwise", since what those mean
 * in raw x/y depends on which side of the board you were aiming at).
 */
export function computeAimBias(darts: CoordDart[]): AimBiasResult | null {
  let sumRadial = 0;
  let sumTangential = 0;
  let n = 0;
  for (const d of darts) {
    if (d.baseValue < 1 || d.baseValue > 20) continue; // excludes miss (0) and bull/bullseye (25/50)
    if (d.multiplier !== 1 && d.multiplier !== 2 && d.multiplier !== 3) continue;
    if (typeof d.boardU !== "number" || typeof d.boardV !== "number") continue;
    const { r: actualR, deg: actualDeg } = toPolar(d.boardU, d.boardV);
    const ideal = idealPointFor(d.baseValue, d.multiplier, actualR);
    if (!ideal) continue;
    const radial = actualR - ideal.r;
    const angleDiff = (((actualDeg - ideal.deg + 180) % 360) + 360) % 360 - 180; // normalize to (-180, 180]
    const tangential = (angleDiff * Math.PI) / 180 * ideal.r; // arc-length approximation (valid for the small offsets this is meant to catch)
    sumRadial += radial;
    sumTangential += tangential;
    n++;
  }
  if (n < MIN_SAMPLE) return null;
  const avgRadialOffset = sumRadial / n;
  const avgTangentialOffset = sumTangential / n;
  return {
    sampleSize: n,
    avgRadialOffset,
    avgTangentialOffset,
    radialOffsetMm: avgRadialOffset * DOUBLE_EDGE_MM,
    tangentialOffsetMm: avgTangentialOffset * DOUBLE_EDGE_MM,
  };
}

/** Below this, a described offset reads as noise rather than a real tendency worth correcting —
 *  same threshold AimBiasCard already used for its "gut getroffen" wording, now shared here so
 *  the diagnosis and the correction advice can never disagree about what counts as "off". */
const NEGLIGIBLE_MM = 0.5;

/**
 * Turns the raw diagnosis into an actual correction, not just a description of the problem —
 * "you're landing left" on its own tells a player what already happened, not what to do about
 * it. Phrased relative to a target near the top of the board (T20, the common case — same
 * reference AimBiasCard's arrow uses) since "clockwise" only means a fixed screen direction once
 * you fix which wedge you're talking about.
 */
export function describeAimTip(result: AimBiasResult): string {
  const parts: string[] = [];
  if (result.radialOffsetMm > NEGLIGIBLE_MM) {
    parts.push("ziel bewusst etwas näher zur Mitte");
  } else if (result.radialOffsetMm < -NEGLIGIBLE_MM) {
    parts.push("du darfst ruhig etwas selbstbewusster nach außen zielen");
  }
  if (result.tangentialOffsetMm > NEGLIGIBLE_MM) {
    parts.push("bei Zielen oben am Board (z. B. T20) leicht nach links korrigieren");
  } else if (result.tangentialOffsetMm < -NEGLIGIBLE_MM) {
    parts.push("bei Zielen oben am Board (z. B. T20) leicht nach rechts korrigieren");
  }
  if (parts.length === 0) return "Deine Wurftendenz ist aktuell unauffällig — einfach so weitermachen.";
  return `Versuch: ${parts.join(" und ")}.`;
}

export { MIN_SAMPLE as AIM_BIAS_MIN_SAMPLE };
