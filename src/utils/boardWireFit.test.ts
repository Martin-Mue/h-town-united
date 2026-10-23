import { describe, expect, it } from "vitest";
import { findBoardTaps, prepareWireFit, refineTapsToWires } from "./boardWireFit";
import { CANON_BOARD_POINTS } from "./cameraGeometry";
import { applyHomography, computeHomography, type Point } from "./homography";

const SIZE = 320;

/** Paints a board seen at an angle: red/green double and treble bands, alternating per segment. */
const renderBoard = (tapsPx: Point[]) => {
  const toCanon = computeHomography(tapsPx, CANON_BOARD_POINTS)!;
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const { x: u, y: v } = applyHomography(toCanon, { x: x + 0.5, y: y + 0.5 });
      const r = Math.hypot(u, v);
      const deg = ((Math.atan2(u, -v) * 180) / Math.PI + 360) % 360;
      const red = Math.floor(((deg + 9) % 360) / 18) % 2 === 0;
      const inDouble = r > 0.953 && r <= 1;
      const inTreble = r > 0.582 && r <= 0.629;
      let rgb = [110, 110, 110];
      if (r > 1) rgb = [30, 30, 30];
      else if (inDouble || inTreble) rgb = red ? [200, 30, 30] : [30, 160, 60];
      else if (r < 0.0935) rgb = r < 0.037 ? [200, 30, 30] : [30, 160, 60];
      const i = (y * SIZE + x) * 4;
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    }
  }
  return prepareWireFit({ data, width: SIZE, height: SIZE });
};

// An obliquely seen board: top edge shorter than the bottom, slightly turned.
const TRUE_TAPS_PX: Point[] = [
  { x: 168, y: 52 }, { x: 150, y: 270 }, { x: 52, y: 166 }, { x: 266, y: 150 },
];
const toFractions = (pts: Point[]) => pts.map((p) => ({ x: p.x / SIZE, y: p.y / SIZE }));
const worstErrorPx = (a: Point[], b: Point[]) => Math.max(...a.map((p, i) => Math.hypot((p.x - b[i].x) * SIZE, (p.y - b[i].y) * SIZE)));

describe("boardWireFit", () => {
  const prepared = renderBoard(TRUE_TAPS_PX);
  const truth = toFractions(TRUE_TAPS_PX);

  it("pulls hand-placed points (several mm off) onto the wires", () => {
    const sloppy = truth.map((p, i) => ({ x: p.x + (i % 2 ? 0.02 : -0.025), y: p.y + (i < 2 ? 0.018 : -0.022) }));
    const fit = refineTapsToWires(prepared, sloppy);
    expect(fit).not.toBeNull();
    expect(fit!.quality).toBeGreaterThan(fit!.startQuality);
    expect(worstErrorPx(fit!.taps, truth)).toBeLessThan(1.5);
  });

  it("finds the board without any starting points", () => {
    const fit = findBoardTaps(prepared);
    expect(fit).not.toBeNull();
    expect(worstErrorPx(fit!.taps, truth)).toBeLessThan(2);
  });

  it("reports no board for a picture without one", () => {
    const blank = prepareWireFit({ data: new Uint8ClampedArray(SIZE * SIZE * 4).fill(120), width: SIZE, height: SIZE });
    expect(findBoardTaps(blank, 400)).toBeNull();
  });
});
