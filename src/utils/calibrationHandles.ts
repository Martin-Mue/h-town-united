import type { Point } from "./homography";

/** Handle order everywhere in the calibration: D20 top, D3 bottom, D11 left, D6 right. */
export const CALIBRATION_HANDLE_LABELS = ["D20", "D3", "D11", "D6"] as const;

/** Four handles on a centred circle covering about 70% of the shorter video side — a starting point
 *  when nothing better (a saved calibration, the model's suggestion) is available. */
export const defaultCalibrationTaps = (videoSize: { w: number; h: number }): Point[] => {
  const radius = 0.35 * Math.min(videoSize.w, videoSize.h);
  const rx = radius / videoSize.w;
  const ry = radius / videoSize.h;
  return [
    { x: 0.5, y: 0.5 - ry },
    { x: 0.5, y: 0.5 + ry },
    { x: 0.5 - rx, y: 0.5 },
    { x: 0.5 + rx, y: 0.5 },
  ];
};
