/**
 * 4-point perspective (homography) transform — lets the 4 calibration taps (D20/D3/D11/D6)
 * correct for an angled camera, not just an off-center/elliptical one.
 *
 * Before this, board-point scoring (see LiveCamera.tsx's boardTransformFromTaps) treated the
 * 4 taps as defining an ellipse (independent x/y radius, no cross-axis skew). That's exact only
 * when the camera looks at the board dead-on; any real tripod/phone-stand angle introduces
 * *keystone* distortion (the board looks like a trapezoid, not just a squashed circle), which an
 * ellipse fit can't represent — it silently mis-scores segments nearer the tilted edge. A full
 * homography is the standard fix (this is the same idea dart-sense's own 4-point calibration
 * uses before scoring): it exactly maps any 4 known-position points (no 3 collinear) from the
 * camera's skewed view to their true positions in a flat reference frame, so radius/angle math
 * downstream is done in genuinely undistorted board space.
 */

export interface Point {
  x: number;
  y: number;
}

/** Row-major 3x3 matrix, flattened, mapping src -> dst in homogeneous coords (dst = H * [x,y,1]^T, then divide by w). */
export type Homography = number[];

/**
 * Solves for the homography mapping each `src[i]` to `dst[i]` (exactly 4 correspondences, the
 * general case — unlike an affine fit, a projective transform needs all 4 to pin down the 8
 * degrees of freedom). Returns null if the points are degenerate (near-collinear taps, e.g. the
 * user tapped the same spot twice) rather than producing a wild/unstable matrix.
 *
 * Standard DLT (direct linear transform) for 4 points: each correspondence gives 2 linear
 * equations in the 8 unknowns (h33 fixed to 1), solved via Gaussian elimination on the
 * resulting 8x8 system.
 */
export function computeHomography(src: Point[], dst: Point[]): Homography | null {
  if (src.length !== 4 || dst.length !== 4) return null;

  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }

  const h = solveLinearSystem(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Maps a point through a homography (perspective divide included). */
export function applyHomography(H: Homography, p: Point): Point {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  if (Math.abs(w) < 1e-9) return { x: 0, y: 0 };
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

/** Gaussian elimination with partial pivoting for a square n x n system A*x = b. Returns null on
 *  a (near-)singular matrix instead of returning garbage from dividing by ~0. */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(M[pivotRow][col]) < 1e-9) return null;
    if (pivotRow !== col) [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    const pivot = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / pivot;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  return M.map((row, i) => row[n] / row[i]);
}
