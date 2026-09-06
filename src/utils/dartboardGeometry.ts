/** Standard dartboard segment order, clockwise starting at the top (20). */
export const SEGMENTS_CLOCKWISE = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/**
 * Standard WDF/PDC ring radii as a fraction of the outer double-ring edge (radius 1.0).
 * Derived from the official mm measurements (double-ring outer radius 170mm):
 *   bull inner 6.35mm, bull outer 15.9mm, treble inner 99mm, treble outer 107mm,
 *   double inner 162mm, double outer 170mm.
 * Round 3 security/accuracy audit (2026-09-06) found trebleInner/trebleOuter had been
 * transposed with roughly half their correct values (0.394/0.429 instead of 0.582/0.629) --
 * likely a stray mm/radius conversion error, since bullInner/bullOuter were already exactly
 * right. This fed both the live camera scoring classification (cameraGeometry.ts's
 * scoreFromBoardPoint()) and the aim-bias coaching engine (aimBias.ts's idealPointFor(), via
 * CoachingPlan.tsx) -- a dart in the real single-inner area (~67-73mm) was misclassified as a
 * treble and vice versa, and aim-bias coaching flagged a large false "too far out" radial bias
 * for players throwing accurately at T20. doubleInner corrected too (162/170 = 0.953, was
 * 0.936) -- a smaller ~3mm error found in the same audit pass.
 */
export const RING = {
  bullInner: 0.037,
  bullOuter: 0.094,
  trebleInner: 0.582,
  trebleOuter: 0.629,
  doubleInner: 0.953,
  doubleOuter: 1.0,
};
