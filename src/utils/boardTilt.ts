import { applyHomography, computeHomography, type Point } from "./homography";
import { CANON_BOARD_POINTS } from "./cameraGeometry";

export interface BoardTilt {
  /** Longest over shortest stretch of the board's picture at its centre: 1 = seen straight on, 1.4 = strongly slanted. */
  ratio: number;
  /** The camera's angle away from the board's axis, in degrees (0 = straight on). */
  tiltDeg: number;
}

/**
 * How slanted the camera looks at the board, from the four calibration points (D20, D3, D11, D6 in normalized video
 * coordinates). A board seen from the side is foreshortened: a circle becomes an ellipse whose short/long axis ratio is
 * cos(angle). Measured on the picture's pixels (hence the video size), at the board centre.
 * Null when the points cannot form a calibration.
 */
export function boardTilt(taps: Point[], videoWidth: number, videoHeight: number): BoardTilt | null {
  if (taps.length !== 4 || videoWidth <= 0 || videoHeight <= 0) return null;
  const px = taps.map((p) => ({ x: p.x * videoWidth, y: p.y * videoHeight }));
  const H = computeHomography(CANON_BOARD_POINTS, px);
  if (!H) return null;
  const e = 1e-3;
  const o = applyHomography(H, { x: 0, y: 0 });
  const dx = applyHomography(H, { x: e, y: 0 });
  const dy = applyHomography(H, { x: 0, y: e });
  // Jacobian of the canonical-board → picture mapping at the centre (columns = the images of the two board axes)
  const a = (dx.x - o.x) / e, c = (dx.y - o.y) / e, b = (dy.x - o.x) / e, d = (dy.y - o.y) / e;
  // Singular values of [[a, b], [c, d]] from the eigenvalues of JᵀJ
  const s11 = a * a + c * c, s22 = b * b + d * d, s12 = a * b + c * d;
  const tr = s11 + s22, det = s11 * s22 - s12 * s12;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const big = Math.sqrt(tr / 2 + disc), small = Math.sqrt(Math.max(0, tr / 2 - disc));
  if (small < 1e-9) return null;
  const ratio = big / small;
  return { ratio, tiltDeg: (Math.acos(Math.min(1, 1 / ratio)) * 180) / Math.PI };
}
