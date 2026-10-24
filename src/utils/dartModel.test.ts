import { describe, it, expect } from "vitest";
import { decodeOutput } from "./dartModel";

describe("decodeOutput", () => {
  it("reads the classic raw head [1, 9, N] (channels first)", () => {
    const n = 2;
    // channels: cx, cy, w, h, dart, cal_1..cal_4 — two anchors, the first a dart at 0.4 score
    const data = new Float32Array(9 * n);
    const set = (c: number, k: number, v: number) => { data[c * n + k] = v; };
    set(0, 0, 400); set(1, 0, 300); set(2, 0, 30); set(3, 0, 30); set(4, 0, 0.4);
    set(0, 1, 100); set(1, 1, 90); set(2, 1, 40); set(3, 1, 40); set(5, 1, 0.9); // cal_1
    const out = decodeOutput({ dims: [1, 9, n], data });
    expect(out.darts).toHaveLength(1);
    expect(out.darts[0]).toMatchObject({ cx: 400, cy: 300, score: expect.closeTo(0.4, 5) });
    expect(out.calPoints.cal_1?.cx).toBe(100);
  });

  it("reads the NMS-free head [1, K, 6] of newer YOLO generations", () => {
    // rows: x1, y1, x2, y2, score, class
    const data = new Float32Array([
      385, 285, 415, 315, 0.62, 0, // dart, centre (400, 300)
      700, 100, 720, 120, 0.08, 0, // below the floor
      80, 70, 120, 110, 0.93, 1, //   cal_1, centre (100, 90)
    ]);
    const out = decodeOutput({ dims: [1, 3, 6], data });
    expect(out.darts).toHaveLength(1);
    expect(out.darts[0]).toMatchObject({ cx: 400, cy: 300, w: 30, h: 30 });
    expect(out.calPoints.cal_1).toMatchObject({ cx: 100, cy: 90 });
    expect(out.maxDartScore).toBeCloseTo(0.62, 5);
  });

  it("reports an unknown shape instead of decoding garbage", () => {
    expect(decodeOutput({ dims: [1, 7, 11], data: new Float32Array(77) }).darts).toHaveLength(0);
  });
});
