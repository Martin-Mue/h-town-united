import { describe, it, expect } from "vitest";
import { buildChangeMap, changedShareNear } from "./changeMask";
import type { PixelBuffer } from "./boardRectify";

const SIZE = 400;
const blank = (): PixelBuffer => ({ data: new Uint8ClampedArray(SIZE * SIZE * 4).fill(120), width: SIZE, height: SIZE });
/** Paints a thin dart-like bar (like a barrel) from (x0,y0) to (x1,y1), fractions of the frame. */
const paintBar = (img: PixelBuffer, x0: number, y0: number, x1: number, y1: number, value = 30) => {
  for (let t = 0; t <= 1; t += 0.002) {
    const cx = Math.round((x0 + (x1 - x0) * t) * SIZE);
    const cy = Math.round((y0 + (y1 - y0) * t) * SIZE);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const i = ((cy + dy) * SIZE + (cx + dx)) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = value;
    }
  }
};

describe("change map", () => {
  it("finds the newly landed dart and ignores the ones already in the picture", () => {
    const before = blank();
    paintBar(before, 0.5, 0.3, 0.55, 0.5); // an earlier dart, present in both pictures
    const after = blank();
    paintBar(after, 0.5, 0.3, 0.55, 0.5);
    paintBar(after, 0.62, 0.35, 0.57, 0.52); // the new dart, close to the old one
    const map = buildChangeMap(before, after)!;
    expect(changedShareNear(map, 0.57, 0.52, 0.04)).toBeGreaterThan(0.1); // at the new tip
    expect(changedShareNear(map, 0.55, 0.5, 0.012)).toBeLessThan(0.1); // at the old tip (it sits within the new one's reach, so only tight radius)
    expect(changedShareNear(map, 0.2, 0.8, 0.05)).toBe(0); // bare board
  });

  it("reports a large share when the whole picture changed (exposure shift)", () => {
    const before = blank();
    const after: PixelBuffer = { data: new Uint8ClampedArray(SIZE * SIZE * 4).fill(190), width: SIZE, height: SIZE };
    expect(buildChangeMap(before, after)!.share).toBeGreaterThan(0.9);
  });

  it("returns null for frames of different size", () => {
    const small: PixelBuffer = { data: new Uint8ClampedArray(10 * 10 * 4), width: 10, height: 10 };
    expect(buildChangeMap(blank(), small)).toBeNull();
  });
});
