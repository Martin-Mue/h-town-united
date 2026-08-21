import { describe, it, expect } from "vitest";
import { computeAimBias, describeAimTip, AIM_BIAS_MIN_SAMPLE, type CoordDart, type AimBiasResult } from "./aimBias";
import { SEGMENTS_CLOCKWISE, RING } from "./dartboardGeometry";
import { translate } from "@/i18n/translations";

const t = (key: string) => translate(key, "de");

/** Builds a synthetic dart landing exactly `radialOff`/`tangentialOff` (board-units) away from
 *  the true ideal center of the given (baseValue, multiplier) ring — the exact inverse of what
 *  computeAimBias is meant to recover, so these tests can assert on a known ground truth instead
 *  of just "some non-zero number came out". */
function perturbedDart(baseValue: number, multiplier: 1 | 2 | 3, radialOff: number, tangentialOff: number): CoordDart {
  const wedgeIndex = SEGMENTS_CLOCKWISE.indexOf(baseValue);
  const deg = wedgeIndex * (360 / 20);
  const r = multiplier === 3 ? (RING.trebleInner + RING.trebleOuter) / 2 : (RING.doubleInner + RING.doubleOuter) / 2;
  const theta = ((deg - 90) * Math.PI) / 180;
  const outward = [Math.cos(theta), Math.sin(theta)];
  const clockwise = [-Math.sin(theta), Math.cos(theta)];
  const u = r * outward[0] + radialOff * outward[0] + tangentialOff * clockwise[0];
  const v = r * outward[1] + radialOff * outward[1] + tangentialOff * clockwise[1];
  return { baseValue, multiplier, boardU: u, boardV: v };
}

describe("computeAimBias", () => {
  it("returns null below the minimum sample size", () => {
    const darts = Array.from({ length: AIM_BIAS_MIN_SAMPLE - 1 }, () => perturbedDart(20, 3, 0, 0));
    expect(computeAimBias(darts)).toBeNull();
  });

  it("reports ~zero offset for darts landing exactly on target", () => {
    const darts = Array.from({ length: AIM_BIAS_MIN_SAMPLE }, () => perturbedDart(20, 3, 0, 0));
    const result = computeAimBias(darts);
    expect(result).not.toBeNull();
    expect(result!.avgRadialOffset).toBeCloseTo(0, 6);
    expect(result!.avgTangentialOffset).toBeCloseTo(0, 6);
  });

  it("recovers a pure radial (too-far-out) bias", () => {
    const darts = Array.from({ length: 25 }, () => perturbedDart(20, 3, 0.02, 0));
    const result = computeAimBias(darts)!;
    expect(result.avgRadialOffset).toBeCloseTo(0.02, 6);
    expect(result.avgTangentialOffset).toBeCloseTo(0, 6);
  });

  it("recovers a pure tangential (clockwise) bias", () => {
    // Tolerance loosened to 3dp (~0.085mm) rather than lab-precision 6dp: perturbedDart offsets
    // along a straight chord, not an arc, so a pure-tangential nudge also inches the radius out
    // very slightly (Pythagoras) — a real, expected second-order artifact of the linear
    // arc-length approximation computeAimBias intentionally uses, negligible at real-world offset
    // magnitudes (a few mm), not a sign or logic error.
    const darts = Array.from({ length: 25 }, () => perturbedDart(20, 3, 0, 0.015));
    const result = computeAimBias(darts)!;
    expect(result.avgRadialOffset).toBeCloseTo(0, 3);
    expect(result.avgTangentialOffset).toBeCloseTo(0.015, 3);
  });

  it("averages the SAME real-world bias consistently across different wedges", () => {
    // The whole point of measuring in each dart's own local (radial, tangential) frame: a
    // player who's consistently "a bit long and a bit clockwise" no matter which number they're
    // at should average out to that one consistent bias, not cancel out across wedges 20/6/11
    // which sit at completely different world angles. (See the tolerance note above for why 3dp.)
    const darts: CoordDart[] = [];
    for (const baseValue of [20, 6, 11, 1, 19]) {
      for (let i = 0; i < 6; i++) darts.push(perturbedDart(baseValue, 3, 0.01, 0.008));
    }
    const result = computeAimBias(darts)!;
    expect(result.sampleSize).toBe(30);
    expect(result.avgRadialOffset).toBeCloseTo(0.01, 3);
    expect(result.avgTangentialOffset).toBeCloseTo(0.008, 3);
  });

  it("converts to millimeters using the regulation 170mm double-edge radius", () => {
    const darts = Array.from({ length: 25 }, () => perturbedDart(20, 2, 0.03, 0));
    const result = computeAimBias(darts)!;
    expect(result.radialOffsetMm).toBeCloseTo(0.03 * 170, 3);
  });

  it("reports ~zero grouping radius when every dart lands at the identical offset", () => {
    // Perfectly consistent (even though biased) — precision is independent of accuracy.
    const darts = Array.from({ length: 25 }, () => perturbedDart(20, 3, 0.02, 0.01));
    const result = computeAimBias(darts)!;
    expect(result.groupingRadius).toBeCloseTo(0, 6);
  });

  it("recovers a known grouping radius from darts alternating around their own mean", () => {
    // Half at +0.02 radial, half at -0.02 radial, same tangential — mean radial is exactly 0,
    // and both halves deviate from that mean by exactly 0.02, so the RMS deviation (= grouping
    // radius) is exactly 0.02, hand-computable, not just "some positive number".
    const darts = [
      ...Array.from({ length: 15 }, () => perturbedDart(20, 3, 0.02, 0)),
      ...Array.from({ length: 15 }, () => perturbedDart(20, 3, -0.02, 0)),
    ];
    const result = computeAimBias(darts)!;
    expect(result.avgRadialOffset).toBeCloseTo(0, 6);
    expect(result.groupingRadius).toBeCloseTo(0.02, 3);
  });

  it("gives a tightly-grouped-but-biased player a smaller grouping radius than a scattered one", () => {
    // The whole point of the metric: two players can share an average offset while one is far
    // more consistent than the other — grouping radius, not avgRadialOffset, is what tells them apart.
    // 26, not 25 — an even count so the alternating +/-0.05 splits perfectly 13/13 and the two
    // groups' mean radial offset comes out identical, not just approximately so.
    const tight = Array.from({ length: 26 }, () => perturbedDart(20, 3, 0.02, 0));
    const scattered = Array.from({ length: 26 }, (_, i) => perturbedDart(20, 3, 0.02 + (i % 2 === 0 ? 0.05 : -0.05), 0));
    const tightResult = computeAimBias(tight)!;
    const scatteredResult = computeAimBias(scattered)!;
    expect(tightResult.avgRadialOffset).toBeCloseTo(scatteredResult.avgRadialOffset, 3); // same bias
    expect(tightResult.groupingRadius).toBeLessThan(scatteredResult.groupingRadius); // different precision
  });

  it("ignores misses and bullseye/bull throws (no wedge angle to measure against)", () => {
    const real = Array.from({ length: AIM_BIAS_MIN_SAMPLE }, () => perturbedDart(20, 3, 0, 0));
    const noise: CoordDart[] = [
      { baseValue: 0, multiplier: 1, boardU: 0.9, boardV: 0.9 }, // miss
      { baseValue: 50, multiplier: 2, boardU: 0, boardV: 0 }, // bullseye
      { baseValue: 25, multiplier: 1, boardU: 0.05, boardV: 0.02 }, // outer bull
    ];
    const result = computeAimBias([...real, ...noise])!;
    expect(result.sampleSize).toBe(AIM_BIAS_MIN_SAMPLE); // the 3 noise darts didn't count
  });

  it("ignores darts with no camera coordinates (manual entry)", () => {
    const withCoords = Array.from({ length: AIM_BIAS_MIN_SAMPLE }, () => perturbedDart(20, 3, 0, 0));
    const manual: CoordDart[] = Array.from({ length: 10 }, () => ({ baseValue: 20, multiplier: 3 }));
    const result = computeAimBias([...withCoords, ...manual])!;
    expect(result.sampleSize).toBe(AIM_BIAS_MIN_SAMPLE);
  });
});

describe("describeAimTip", () => {
  const withOffsets = (radialOffsetMm: number, tangentialOffsetMm: number): AimBiasResult => ({
    sampleSize: 30, avgRadialOffset: 0, avgTangentialOffset: 0, radialOffsetMm, tangentialOffsetMm,
    groupingRadius: 0, groupingRadiusMm: 0,
  });

  it("matches the real case that prompted this feature: landing left → correct right", () => {
    // Actual user-reported reading: +6.8mm radial (too far out), -3.1mm tangential — confirmed
    // by the user themselves as a real, felt left-leaning tendency. -3.1 must produce "nach
    // rechts" (correct right to counteract drifting left), never "nach links".
    const tip = describeAimTip(withOffsets(6.8, -3.1), t);
    expect(tip).toContain("nach rechts");
    expect(tip).not.toContain("nach links");
    expect(tip).toContain("näher zur Mitte");
  });

  it("tells a clockwise (right-drifting) bias to correct left", () => {
    const tip = describeAimTip(withOffsets(0, 3.1), t);
    expect(tip).toContain("nach links");
    expect(tip).not.toContain("nach rechts");
  });

  it("tells a too-short bias to aim further out, not closer in", () => {
    const tip = describeAimTip(withOffsets(-6.8, 0), t);
    expect(tip).toContain("nach außen");
    expect(tip).not.toContain("näher zur Mitte");
  });

  it("says nothing needs correcting when both offsets are negligible", () => {
    const tip = describeAimTip(withOffsets(0.2, -0.1), t);
    expect(tip).toMatch(/unauffällig/);
  });
});
