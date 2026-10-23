/**
 * Straightens the camera's view of the board into a flat, top-down picture ("rectified frame").
 *
 * The 4 calibration taps (D20/D3/D11/D6, see cameraGeometry.CANON_BOARD_POINTS) pin the board's plane
 * down exactly, so any camera angle, zoom or in-frame rotation can be undone with one perspective
 * transform. The rectified frame always has the same layout — 20 at the top, the double ring's outer
 * edge at RECT_BOARD_RADIUS of the frame width — which is also how the shipped dart model's own
 * training pictures look (measured: its corner points sit at 0.377 of the frame). So the model
 * always sees a board at the scale it was trained for, and a dart tip (which touches the board plane)
 * maps back to the camera image exactly. Everything here is pure math on pixel arrays, no DOM.
 */

import { computeHomography, applyHomography, type Homography, type Point } from "./homography";
import { CANON_BOARD_POINTS } from "./cameraGeometry";
import { RING, SEGMENTS_CLOCKWISE } from "./dartboardGeometry";

export const RECT_SIZE = 800;
/** Radius of the double ring's outer edge as a fraction of the rectified frame's width. */
export const RECT_BOARD_RADIUS = 0.377;

export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RectifyMapping {
  /** rectified-frame fraction -> camera-video fraction */
  rectToVideo: Homography;
  /** camera-video fraction -> rectified-frame fraction */
  videoToRect: Homography;
  /** board-canonical (double edge = radius 1) -> camera-video fraction */
  canonToVideo: Homography;
}

/** Rectified-frame fraction -> board-canonical coordinates (x right, y down, radius 1 = double edge). */
export const rectToCanonical = (x: number, y: number): Point => ({
  x: (x - 0.5) / RECT_BOARD_RADIUS,
  y: (y - 0.5) / RECT_BOARD_RADIUS,
});

export const canonicalToRect = (u: number, v: number): Point => ({
  x: 0.5 + u * RECT_BOARD_RADIUS,
  y: 0.5 + v * RECT_BOARD_RADIUS,
});

/** Builds the mappings from the four D20/D3/D11/D6 taps (camera-video fractions). Null if degenerate. */
export const rectifyMappingFromTaps = (taps: Point[] | undefined): RectifyMapping | null => {
  if (!taps || taps.length !== 4) return null;
  const rectPoints = CANON_BOARD_POINTS.map((p) => canonicalToRect(p.x, p.y));
  const rectToVideo = computeHomography(rectPoints, taps);
  const videoToRect = computeHomography(taps, rectPoints);
  const canonToVideo = computeHomography(CANON_BOARD_POINTS, taps);
  if (!rectToVideo || !videoToRect || !canonToVideo) return null;
  return { rectToVideo, videoToRect, canonToVideo };
};

const BACKGROUND = 43;

/**
 * Renders the rectified frame: every output pixel is looked up in the camera picture through
 * rectToVideo, with bilinear interpolation. Pixels that fall outside the camera picture stay dark grey.
 */
export const warpToRectified = (src: PixelBuffer, rectToVideo: Homography, size = RECT_SIZE): PixelBuffer => {
  const out = new Uint8ClampedArray(size * size * 4);
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = rectToVideo;
  const { data, width: sw, height: sh } = src;
  for (let y = 0; y < size; y++) {
    const fy = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) / size;
      const o = (y * size + x) * 4;
      const w = h6 * fx + h7 * fy + h8;
      if (Math.abs(w) < 1e-9) { out[o] = out[o + 1] = out[o + 2] = BACKGROUND; out[o + 3] = 255; continue; }
      const px = ((h0 * fx + h1 * fy + h2) / w) * sw - 0.5;
      const py = ((h3 * fx + h4 * fy + h5) / w) * sh - 0.5;
      if (px < -0.5 || py < -0.5 || px > sw - 0.5 || py > sh - 0.5) {
        out[o] = out[o + 1] = out[o + 2] = BACKGROUND; out[o + 3] = 255; continue;
      }
      const x0 = Math.max(0, Math.floor(px)), y0 = Math.max(0, Math.floor(py));
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const tx = Math.min(1, Math.max(0, px - x0)), ty = Math.min(1, Math.max(0, py - y0));
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c] * (1 - tx) + data[i10 + c] * tx;
        const bottom = data[i01 + c] * (1 - tx) + data[i11 + c] * tx;
        out[o + c] = top * (1 - ty) + bottom * ty;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: size, height: size };
};

export interface BoardOverlayLines {
  /** Closed polylines for the bull, treble and double rings, in camera-video fractions. */
  rings: Point[][];
  /** The 20 segment boundaries as [from, to] pairs, in camera-video fractions. */
  spokes: [Point, Point][];
}

/** The scoring geometry drawn over the camera picture, so a calibration can be judged at a glance. */
export const boardOverlayLines = (canonToVideo: Homography, ringStepDeg = 6): BoardOverlayLines => {
  const at = (r: number, deg: number): Point => {
    const a = (deg * Math.PI) / 180;
    return applyHomography(canonToVideo, { x: r * Math.sin(a), y: -r * Math.cos(a) });
  };
  const radii = [RING.bullInner, RING.bullOuter, RING.trebleInner, RING.trebleOuter, RING.doubleInner, RING.doubleOuter];
  const rings = radii.map((r) => {
    const pts: Point[] = [];
    for (let deg = 0; deg <= 360; deg += ringStepDeg) pts.push(at(r, deg));
    return pts;
  });
  const spokes: [Point, Point][] = [];
  for (let k = 0; k < SEGMENTS_CLOCKWISE.length; k++) {
    const deg = k * 18 + 9;
    spokes.push([at(RING.bullOuter, deg), at(RING.doubleOuter, deg)]);
  }
  return { rings, spokes };
};
