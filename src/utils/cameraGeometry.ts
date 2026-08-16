/**
 * Pure coordinate-geometry math for LiveCamera.tsx's camera/board-scoring pipeline — factored
 * out specifically so it's unit-testable (see cameraGeometry.test.ts) without mounting the
 * component, touching the DOM, or needing a real camera. LiveCamera.tsx keeps thin wrappers
 * that read videoRef/videoBoxRef/calib and delegate to these.
 *
 * Three coordinate spaces are in play, and mixing them up is exactly what caused two real bugs
 * (2026-08-16): mis-scored repositioned darts, and a visually offset tap-to-place marker.
 *
 *  - "screen" fraction: 0-1 across the on-screen (CSS) video box, exactly what a tap/click
 *    reports via getBoundingClientRect.
 *  - "video" (aka "full-frame") fraction: 0-1 across the camera's NATIVE decoded frame
 *    (videoWidth/videoHeight) — what cropRect/canvas readback/the detection model all actually
 *    operate on. Differs from "screen" fraction whenever the video's native aspect ratio
 *    doesn't match the on-screen box's (object-cover then crops one axis) — see
 *    computeVisibleWindow.
 *  - "crop" fraction: 0-1 across the square analysis crop (cropRect) taken from video-fraction
 *    space, centered/sized by the user's calibration (calib.x/y/size).
 */
import { computeHomography, applyHomography, type Homography, type Point } from "./homography";
import { SEGMENTS_CLOCKWISE, RING } from "./dartboardGeometry";

export interface VisibleWindow { ox: number; oy: number; sw: number; sh: number }
export interface CropRect { sx: number; sy: number; side: number }

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** See file header — the on-screen box's sub-window into the native video frame, as a fraction
 *  of that frame. (ox,oy) is the sub-window's top-left, (sw,sh) its size. {0,0,1,1} means no
 *  crop (aspect ratios match). Null if either dimension is unknown/zero (video not loaded yet,
 *  box not measured — e.g. display:none). */
export const computeVisibleWindow = (
  videoWidth: number, videoHeight: number, boxWidth: number, boxHeight: number,
): VisibleWindow | null => {
  if (!videoWidth || !videoHeight || !boxWidth || !boxHeight) return null;
  const videoAspect = videoWidth / videoHeight;
  const boxAspect = boxWidth / boxHeight;
  if (videoAspect > boxAspect) {
    // Video relatively wider than the box -> object-cover crops the left/right edges.
    const sw = boxAspect / videoAspect;
    return { ox: (1 - sw) / 2, oy: 0, sw, sh: 1 };
  }
  // Video relatively taller than the box -> object-cover crops the top/bottom edges.
  const sh = videoAspect / boxAspect;
  return { ox: 0, oy: (1 - sh) / 2, sw: 1, sh };
};

/** On-screen tap (fraction of the displayed video box, 0-1) -> fraction of the native video
 *  frame. For calibration taps and reposition taps, which are captured via getBoundingClientRect
 *  of the on-screen box and must be converted before use in any board-geometry math. */
export const screenToVideoFraction = (nx: number, ny: number, win: VisibleWindow): Point => ({
  x: clamp(win.ox + nx * win.sw, 0, 1),
  y: clamp(win.oy + ny * win.sh, 0, 1),
});

/** Inverse of the above — a fraction of the native video frame -> where that point actually
 *  renders within the on-screen (possibly cropped) video box, for drawing markers/rings/dots. */
export const videoToScreenFraction = (fx: number, fy: number, win: VisibleWindow): Point | null => {
  if (!win.sw || !win.sh) return null;
  return { x: clamp((fx - win.ox) / win.sw, 0, 1), y: clamp((fy - win.oy) / win.sh, 0, 1) };
};

/** The square analysis-crop region (in native video pixels) — centered at calib.x/y, sized by
 *  calib.size, clamped to stay within the frame and within a sane min/max fraction of it. */
export const computeCropRect = (
  videoWidth: number, videoHeight: number, calibX: number, calibY: number, calibSize: number,
): CropRect | null => {
  if (!videoWidth || !videoHeight) return null;
  const minSide = Math.min(videoWidth, videoHeight);
  const side = clamp(minSide * calibSize, minSide * 0.4, minSide * 0.98);
  const cx = videoWidth * calibX;
  const cy = videoHeight * calibY;
  const sx = clamp(cx - side / 2, 0, videoWidth - side);
  const sy = clamp(cy - side / 2, 0, videoHeight - side);
  return { sx, sy, side };
};

/** A point relative to the cropped/zoomed analysis frame (0-1) -> the full video frame (the
 *  same space calibration taps and the live overlay both use, once already converted out of
 *  screen space — see screenToVideoFraction). Shared by dart positions and the model's
 *  auto-detected calibration corners, so both land in the same coordinate convention. */
export const cropToVideoFraction = (
  x: number, y: number, videoWidth: number, videoHeight: number, rect: CropRect,
): Point | null => {
  if (!videoWidth || !videoHeight) return null;
  return { x: (rect.sx + x * rect.side) / videoWidth, y: (rect.sy + y * rect.side) / videoHeight };
};

/** Inverse of the above — native-video-frame fraction -> crop-relative fraction, for manually
 *  repositioning a mis-detected dart's tip. */
export const videoFractionToCrop = (
  fx: number, fy: number, videoWidth: number, videoHeight: number, rect: CropRect,
): Point | null => {
  if (!videoWidth || !videoHeight || !rect.side) return null;
  return {
    x: clamp((fx * videoWidth - rect.sx) / rect.side, 0, 1),
    y: clamp((fy * videoHeight - rect.sy) / rect.side, 0, 1),
  };
};

// ─── calibration-based board scoring ─────────────────────────────────
// The AI is good at pointing at a pixel, but unreliable at eyeballing which of 82 thin wedges
// that pixel falls in. Since every session already collects a precise 4-point calibration
// (D20/D3/D11/D6 outer-double-edge taps), use that known geometry to compute the segment/ring
// deterministically instead of trusting the AI's own segment/multiplier guess.
export const MISS_TOLERANCE = 1.06; // calibration is never pixel-perfect — a little slack beyond the double edge

// Canonical board-space targets for the 4 calibration taps — top/bottom/left/right of the
// double ring, mapped to a unit circle (radius 1 = double edge). Matches the angle convention
// scoreFromBoardPoint uses (0° = top = D20, growing clockwise).
export const CANON_BOARD_POINTS: Point[] = [
  { x: 0, y: -1 }, // D20 (top)
  { x: 0, y: 1 },  // D3 (bottom)
  { x: -1, y: 0 }, // D11 (left)
  { x: 1, y: 0 },  // D6 (right)
];

/**
 * Builds the perspective (homography) transform from the 4 raw calibration taps (video-frame
 * coords) to canonical board space. A full homography — not just an ellipse fit from a center +
 * two radii — correctly undoes camera *keystone* (an angled camera makes the board look like a
 * trapezoid, not just a squashed circle); see homography.ts for why this matters.
 *
 * `liveCenter`, when given, shifts all 4 taps by the same vector before solving — approximating
 * "the whole board drifted a few cm, camera angle unchanged" (bumped table, wobbly phone mount)
 * so scoring stays correct without a pixel-perfect re-tap.
 */
export const boardTransformFromTaps = (taps?: Point[], liveCenter?: Point): Homography | null => {
  if (!taps || taps.length !== 4) return null;
  const [top, bottom, left, right] = taps; // D20, D3, D11, D6
  let src = taps;
  if (liveCenter) {
    const origCx = (left.x + right.x) / 2;
    const origCy = (top.y + bottom.y) / 2;
    const dx = liveCenter.x - origCx;
    const dy = liveCenter.y - origCy;
    if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
      src = taps.map((t) => ({ x: t.x + dx, y: t.y + dy }));
    }
  }
  return computeHomography(src, CANON_BOARD_POINTS);
};

export interface BoardScore { baseValue: number; multiplier: 1 | 2 | 3; points: number; u: number; v: number }

// u/v are the tip position in board-relative unit coordinates (0,0 = bull center, radius
// ~1.0 = the calibrated double-ring edge) — independent of camera framing/zoom, so unlike
// the raw video-frame x/y they're safe to persist and compare across different games,
// sessions and devices (see the per-player heatmap in Statistics).
export const scoreFromBoardPoint = (fx: number, fy: number, H: Homography): BoardScore => {
  const { x: u, y: v } = applyHomography(H, { x: fx, y: fy });
  const radius = Math.hypot(u, v);
  let angleDeg = (Math.atan2(v, u) * 180) / Math.PI + 90; // 0° = top (D20), growing clockwise
  angleDeg = ((angleDeg % 360) + 360) % 360;
  const baseValue = SEGMENTS_CLOCKWISE[Math.round(angleDeg / 18) % 20];

  if (radius <= RING.bullInner) return { baseValue: 25, multiplier: 2, points: 50, u, v };
  if (radius <= RING.bullOuter) return { baseValue: 25, multiplier: 1, points: 25, u, v };
  if (radius <= RING.trebleInner) return { baseValue, multiplier: 1, points: baseValue, u, v };
  if (radius <= RING.trebleOuter) return { baseValue, multiplier: 3, points: baseValue * 3, u, v };
  if (radius <= RING.doubleInner) return { baseValue, multiplier: 1, points: baseValue, u, v };
  if (radius <= MISS_TOLERANCE) return { baseValue, multiplier: 2, points: baseValue * 2, u, v };
  return { baseValue: 0, multiplier: 1, points: 0, u, v };
};
