import { describe, it, expect } from "vitest";
import {
  RECT_BOARD_RADIUS,
  rectifyMappingFromTaps,
  warpToRectified,
  rectToCanonical,
  canonicalToRect,
  boardOverlayLines,
} from "./boardRectify";
import { applyHomography, computeHomography } from "./homography";
import { CANON_BOARD_POINTS } from "./cameraGeometry";

// A made-up camera view of the board: rotated, squeezed (tilted) and off-centre, in video fractions.
const view = (u: number, v: number) => {
  const a = (12 * Math.PI) / 180;
  const x = u * 0.30, y = v * 0.2;
  return { x: 0.46 + x * Math.cos(a) - y * Math.sin(a), y: 0.52 + x * Math.sin(a) + y * Math.cos(a) };
};
const taps = CANON_BOARD_POINTS.map((p) => view(p.x, p.y));

describe("rectifyMappingFromTaps", () => {
  it("maps the rectified centre and the four double-ring points onto the camera view", () => {
    const m = rectifyMappingFromTaps(taps)!;
    const centre = applyHomography(m.rectToVideo, { x: 0.5, y: 0.5 });
    expect(centre.x).toBeCloseTo(view(0, 0).x, 6);
    expect(centre.y).toBeCloseTo(view(0, 0).y, 6);
    const top = applyHomography(m.rectToVideo, canonicalToRect(0, -1));
    expect(top.x).toBeCloseTo(taps[0].x, 6);
    expect(top.y).toBeCloseTo(taps[0].y, 6);
  });

  it("videoToRect is the inverse of rectToVideo", () => {
    const m = rectifyMappingFromTaps(taps)!;
    const p = { x: 0.31, y: 0.77 };
    const back = applyHomography(m.rectToVideo, applyHomography(m.videoToRect, p));
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it("returns null for missing or degenerate taps", () => {
    expect(rectifyMappingFromTaps(undefined)).toBeNull();
    expect(rectifyMappingFromTaps([{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }])).toBeNull();
  });
});

describe("rectToCanonical / canonicalToRect", () => {
  it("round-trips and puts the double edge at RECT_BOARD_RADIUS", () => {
    expect(canonicalToRect(1, 0).x).toBeCloseTo(0.5 + RECT_BOARD_RADIUS, 9);
    const c = rectToCanonical(0.62, 0.4);
    const r = canonicalToRect(c.x, c.y);
    expect(r.x).toBeCloseTo(0.62, 9);
    expect(r.y).toBeCloseTo(0.4, 9);
  });
});

describe("warpToRectified", () => {
  it("renders every output pixel from the right place in the camera picture", () => {
    const m = rectifyMappingFromTaps(taps)!;
    // Camera picture whose colour encodes the canonical board coordinate under each pixel.
    const W = 360, H = 640;
    const canonOfVideo = computeHomography(taps, CANON_BOARD_POINTS)!;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = applyHomography(canonOfVideo, { x: (x + 0.5) / W, y: (y + 0.5) / H });
        const o = (y * W + x) * 4;
        data[o] = 128 + c.x * 80; data[o + 1] = 128 + c.y * 80; data[o + 2] = 0; data[o + 3] = 255;
      }
    }
    const out = warpToRectified({ data, width: W, height: H }, m.rectToVideo, 200);
    let worst = 0;
    for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.2], [0.3, 0.5], [0.62, 0.7], [0.45, 0.35]]) {
      const o = (Math.floor(fy * 200) * 200 + Math.floor(fx * 200)) * 4;
      const want = rectToCanonical((Math.floor(fx * 200) + 0.5) / 200, (Math.floor(fy * 200) + 0.5) / 200);
      worst = Math.max(worst, Math.abs((out.data[o] - 128) / 80 - want.x), Math.abs((out.data[o + 1] - 128) / 80 - want.y));
    }
    expect(worst).toBeLessThan(0.03); // colour quantisation + interpolation only
  });

  it("fills pixels outside the camera picture with the dark background", () => {
    const m = rectifyMappingFromTaps(taps)!;
    const src = { data: new Uint8ClampedArray(16 * 16 * 4).fill(255), width: 16, height: 16 };
    const far = warpToRectified(src, [1, 0, 5, 0, 1, 5, 0, 0, 1], 8); // maps everything far off-picture
    expect(far.data[0]).toBe(43);
    void m;
  });
});

describe("boardOverlayLines", () => {
  it("draws 6 rings and 20 spokes in camera-video fractions around the board", () => {
    const m = rectifyMappingFromTaps(taps)!;
    const o = boardOverlayLines(m.canonToVideo);
    expect(o.rings).toHaveLength(6);
    expect(o.spokes).toHaveLength(20);
    const outer = o.rings[5];
    expect(outer[0].x).toBeCloseTo(taps[0].x, 6); // 0 deg = top = the D20 tap
    expect(outer[0].y).toBeCloseTo(taps[0].y, 6);
  });
});
