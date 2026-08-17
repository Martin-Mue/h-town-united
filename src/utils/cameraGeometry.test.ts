import { describe, it, expect } from "vitest";
import {
  computeVisibleWindow,
  screenToVideoFraction,
  videoToScreenFraction,
  computeCropRect,
  cropToVideoFraction,
  videoFractionToCrop,
  computeCropScreenRect,
  boardTransformFromTaps,
  scoreFromBoardPoint,
  CANON_BOARD_POINTS,
  MISS_TOLERANCE,
} from "./cameraGeometry";

const EPS = 1e-9;

describe("computeVisibleWindow", () => {
  it("returns the full frame (no crop) when aspect ratios match", () => {
    expect(computeVisibleWindow(400, 400, 300, 300)).toEqual({ ox: 0, oy: 0, sw: 1, sh: 1 });
  });

  it("crops left/right when the video is relatively wider than the box (the real-world case: 16:9 camera in a square box)", () => {
    // This is the exact scenario behind the 2026-08-16 coordinate bug: a 1280x720 stream
    // object-cover-fit into a forced-square on-screen box.
    const win = computeVisibleWindow(1280, 720, 400, 400)!;
    expect(win.oy).toBe(0);
    expect(win.sh).toBe(1);
    // visible width fraction = boxAspect / videoAspect = 1 / (1280/720)
    expect(win.sw).toBeCloseTo(720 / 1280, 10);
    expect(win.ox).toBeCloseTo((1 - 720 / 1280) / 2, 10);
  });

  it("crops top/bottom when the video is relatively taller than the box", () => {
    const win = computeVisibleWindow(720, 1280, 400, 400)!;
    expect(win.ox).toBe(0);
    expect(win.sw).toBe(1);
    expect(win.sh).toBeCloseTo(720 / 1280, 10);
    expect(win.oy).toBeCloseTo((1 - 720 / 1280) / 2, 10);
  });

  it("returns null when a dimension is unknown (video not loaded / box not measured yet)", () => {
    expect(computeVisibleWindow(0, 0, 400, 400)).toBeNull();
    expect(computeVisibleWindow(1280, 720, 0, 0)).toBeNull();
  });
});

describe("screenToVideoFraction / videoToScreenFraction round-trip", () => {
  const windows = [
    { name: "no crop", win: computeVisibleWindow(400, 400, 300, 300)! },
    { name: "16:9 video in square box (real camera case)", win: computeVisibleWindow(1280, 720, 400, 400)! },
    { name: "portrait video in square box", win: computeVisibleWindow(720, 1280, 400, 400)! },
    { name: "extreme wide video", win: computeVisibleWindow(2000, 500, 400, 400)! },
  ];
  const points = [
    [0.5, 0.5], [0, 0], [1, 1], [0.1, 0.9], [0.73, 0.12],
  ];

  for (const { name, win } of windows) {
    it(`is an exact inverse for "${name}"`, () => {
      for (const [nx, ny] of points) {
        const video = screenToVideoFraction(nx, ny, win);
        const backToScreen = videoToScreenFraction(video.x, video.y, win)!;
        expect(backToScreen.x).toBeCloseTo(nx, 10);
        expect(backToScreen.y).toBeCloseTo(ny, 10);
      }
    });

    it(`center (0.5,0.5) maps to itself for "${name}" (crop is always centered)`, () => {
      const video = screenToVideoFraction(0.5, 0.5, win);
      expect(video.x).toBeCloseTo(0.5, 10);
      expect(video.y).toBeCloseTo(0.5, 10);
    });
  }

  it("screen (0,0)/(1,1) land exactly at the crop window's own corners in video space", () => {
    const win = computeVisibleWindow(1280, 720, 400, 400)!;
    const topLeft = screenToVideoFraction(0, 0, win);
    expect(topLeft.x).toBeCloseTo(win.ox, 10);
    expect(topLeft.y).toBeCloseTo(win.oy, 10);
    const bottomRight = screenToVideoFraction(1, 1, win);
    expect(bottomRight.x).toBeCloseTo(win.ox + win.sw, 10);
    expect(bottomRight.y).toBeCloseTo(win.oy + win.sh, 10);
  });
});

describe("computeCropRect", () => {
  it("centers a square crop at calib.x/y, sized by calib.size, in native video pixels", () => {
    // 1280x720 video, minSide=720. calib.size=0.5 -> side=360, centered at (50%,50%) of the frame.
    const rect = computeCropRect(1280, 720, 0.5, 0.5, 0.5)!;
    expect(rect.side).toBe(360);
    expect(rect.sx).toBe(1280 * 0.5 - 180);
    expect(rect.sy).toBe(720 * 0.5 - 180);
  });

  it("clamps the crop so it never runs off the frame edge", () => {
    // calib.x near 0 would put the crop's left edge at a negative x without clamping.
    const rect = computeCropRect(1280, 720, 0.05, 0.5, 0.5)!;
    expect(rect.sx).toBeGreaterThanOrEqual(0);
    // calib.x near 1 would push the crop's right edge past the frame width.
    const rectRight = computeCropRect(1280, 720, 0.95, 0.5, 0.5)!;
    expect(rectRight.sx + rectRight.side).toBeLessThanOrEqual(1280 + EPS);
  });

  it("clamps calib.size to the [0.4, 0.98] range", () => {
    const tooSmall = computeCropRect(1000, 1000, 0.5, 0.5, 0.01)!;
    expect(tooSmall.side).toBe(400); // 0.4 * minSide(1000)
    const tooBig = computeCropRect(1000, 1000, 0.5, 0.5, 5)!;
    expect(tooBig.side).toBe(980); // 0.98 * minSide(1000)
  });

  it("returns null without valid video dimensions", () => {
    expect(computeCropRect(0, 0, 0.5, 0.5, 0.8)).toBeNull();
  });
});

describe("cropToVideoFraction / videoFractionToCrop round-trip", () => {
  it("is an exact inverse for a real crop rect", () => {
    const rect = computeCropRect(1280, 720, 0.4, 0.6, 0.7)!;
    for (const [x, y] of [[0, 0], [1, 1], [0.5, 0.5], [0.13, 0.87]]) {
      const video = cropToVideoFraction(x, y, 1280, 720, rect)!;
      const backToCrop = videoFractionToCrop(video.x, video.y, 1280, 720, rect)!;
      expect(backToCrop.x).toBeCloseTo(x, 10);
      expect(backToCrop.y).toBeCloseTo(y, 10);
    }
  });

  it("crop-space center maps to the crop rect's own center in video-fraction space", () => {
    const rect = computeCropRect(1280, 720, 0.5, 0.5, 0.5)!;
    const center = cropToVideoFraction(0.5, 0.5, 1280, 720, rect)!;
    expect(center.x).toBeCloseTo(0.5, 10);
    expect(center.y).toBeCloseTo(0.5, 10);
  });
});

describe("computeCropScreenRect (the live tracking ring)", () => {
  // The square box itself (LiveCamera.tsx's video container is `aspect-square`) — a correct
  // crop-to-screen conversion must render as a true square regardless of the camera stream's
  // own aspect ratio, since object-cover scales the video uniformly (no x/y stretch).
  it("renders as a true square for a landscape 16:9 stream (the 2026-08-17 wide-oval report)", () => {
    const win = computeVisibleWindow(1280, 720, 400, 400)!;
    const rect = computeCropScreenRect(1280, 720, 0.5, 0.5, 0.7, win)!;
    expect(rect.width).toBeCloseTo(rect.height, 10);
  });

  it("renders as a true square for a portrait 9:16 stream (the reported tall/vertical oval)", () => {
    const win = computeVisibleWindow(720, 1280, 400, 400)!;
    const rect = computeCropScreenRect(720, 1280, 0.5, 0.5, 0.7, win)!;
    expect(rect.width).toBeCloseTo(rect.height, 10);
  });

  it("matches calib.size directly when the stream is already square (sanity check)", () => {
    const win = computeVisibleWindow(400, 400, 400, 400)!;
    const rect = computeCropScreenRect(400, 400, 0.5, 0.5, 0.6, win)!;
    expect(rect.width).toBeCloseTo(0.6, 10);
    expect(rect.height).toBeCloseTo(0.6, 10);
  });

  it("stays centered on calib.x/y when no edge-clamping is in play", () => {
    const win = computeVisibleWindow(1280, 720, 400, 400)!;
    const rect = computeCropScreenRect(1280, 720, 0.5, 0.5, 0.5, win)!;
    expect(rect.x + rect.width / 2).toBeCloseTo(0.5, 10);
    expect(rect.y + rect.height / 2).toBeCloseTo(0.5, 10);
  });

  it("returns null without valid video dimensions", () => {
    const win = computeVisibleWindow(1280, 720, 400, 400)!;
    expect(computeCropScreenRect(0, 0, 0.5, 0.5, 0.7, win)).toBeNull();
  });
});

describe("boardTransformFromTaps + scoreFromBoardPoint (the actual scoring pipeline)", () => {
  // A simple, axis-aligned, non-degenerate set of taps: D20 top, D3 bottom, D11 left, D6 right,
  // double-ring radius 0.3 (in this made-up full-frame-fraction space) centered at (0.5, 0.5).
  const taps = [
    { x: 0.5, y: 0.2 }, // D20 (top)
    { x: 0.5, y: 0.8 }, // D3 (bottom)
    { x: 0.2, y: 0.5 }, // D11 (left)
    { x: 0.8, y: 0.5 }, // D6 (right)
  ];

  it("returns null for anything other than exactly 4 taps", () => {
    expect(boardTransformFromTaps(undefined)).toBeNull();
    expect(boardTransformFromTaps([])).toBeNull();
    expect(boardTransformFromTaps(taps.slice(0, 3))).toBeNull();
  });

  it("maps the 4 taps themselves exactly onto CANON_BOARD_POINTS", () => {
    const H = boardTransformFromTaps(taps)!;
    expect(H).not.toBeNull();
    taps.forEach((tap, i) => {
      const scored = scoreFromBoardPoint(tap.x, tap.y, H);
      expect(Math.hypot(scored.u - CANON_BOARD_POINTS[i].x, scored.v - CANON_BOARD_POINTS[i].y)).toBeLessThan(1e-6);
    });
  });

  it("scores dead center as bullseye (50)", () => {
    const H = boardTransformFromTaps(taps)!;
    const scored = scoreFromBoardPoint(0.5, 0.5, H);
    expect(scored).toMatchObject({ baseValue: 25, multiplier: 2, points: 50 });
  });

  it("scores a point just past the double-ring edge (but within MISS_TOLERANCE) as a double", () => {
    const H = boardTransformFromTaps(taps)!;
    // Straight up from center, at u/v radius MISS_TOLERANCE - epsilon -> just inside the
    // tolerated double band. Top of the board (angle 0) is segment 20.
    const fy = 0.5 - 0.3 * (MISS_TOLERANCE - 0.01); // taps place the double edge at radius 0.3 in fx/fy space
    const scored = scoreFromBoardPoint(0.5, fy, H);
    expect(scored.baseValue).toBe(20);
    expect(scored.multiplier).toBe(2);
  });

  it("scores a point well outside MISS_TOLERANCE as a miss", () => {
    const H = boardTransformFromTaps(taps)!;
    const scored = scoreFromBoardPoint(0.5, 0.5 - 0.3 * (MISS_TOLERANCE + 0.5), H);
    expect(scored).toMatchObject({ baseValue: 0, multiplier: 1, points: 0 });
  });

  it("shifts scoring correctly when liveCenter approximates board drift", () => {
    // The whole board (still an ellipse of the same taps) drifted +0.05 on the x axis, +0.02 on y —
    // liveCenter should let the same taps keep scoring correctly around the NEW center.
    const driftedCenter = { x: 0.55, y: 0.52 };
    const H = boardTransformFromTaps(taps, driftedCenter)!;
    const scored = scoreFromBoardPoint(driftedCenter.x, driftedCenter.y, H);
    expect(scored).toMatchObject({ baseValue: 25, multiplier: 2, points: 50 });
  });
});
