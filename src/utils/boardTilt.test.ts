import { describe, expect, it } from "vitest";
import { boardTilt } from "./boardTilt";

/** The four calibration points of a board of radius r (video pixels) around (cx, cy), squashed horizontally by cos(angle). */
const tapsFor = (cx: number, cy: number, r: number, squash: number, w: number, h: number) => [
  { x: cx / w, y: (cy - r) / h }, { x: cx / w, y: (cy + r) / h },
  { x: (cx - r * squash) / w, y: cy / h }, { x: (cx + r * squash) / w, y: cy / h },
];

describe("boardTilt", () => {
  it("reads 0° for a board seen straight on, whatever the video's shape", () => {
    expect(boardTilt(tapsFor(540, 960, 400, 1, 1080, 1920), 1080, 1920)!.tiltDeg).toBeLessThan(0.5);
    expect(boardTilt(tapsFor(960, 540, 400, 1, 1920, 1080), 1920, 1080)!.tiltDeg).toBeLessThan(0.5);
  });

  it("recovers the angle of a board squashed to cos(angle)", () => {
    for (const deg of [20, 35, 50]) {
      const t = boardTilt(tapsFor(540, 960, 400, Math.cos((deg * Math.PI) / 180), 1080, 1920), 1080, 1920)!;
      expect(t.tiltDeg).toBeGreaterThan(deg - 1.5);
      expect(t.tiltDeg).toBeLessThan(deg + 1.5);
    }
  });

  it("gives null for unusable points", () => {
    expect(boardTilt([], 1080, 1920)).toBeNull();
    expect(boardTilt(tapsFor(540, 960, 0, 1, 1080, 1920), 1080, 1920)).toBeNull();
  });
});
