// Converts the OLD training samples (plain 420px crops, saved before the board was straightened) into
// the RECTIFIED frame the app now feeds the model, so they can be used for training right away.
//
//   node scripts/training/legacy-to-rectified.mjs <training-dataset.json> <taps.json> <output-dir>
//
// <training-dataset.json>  the file from Admin -> KI-Trainer -> "Trainingsset exportieren"
// <taps.json>              [{ "id": "...", "calib_taps": [{x,y} x4] }, ...] — the calibration each sample
//                          was taken with (training_samples.calib_taps)
//
// Assumptions, all checked against real data: the camera picture was PORTRAIT 9:16 (all four calibration
// points then land on the double ring's top/bottom/left/right in the saved crop), and the analysis crop
// was the one the calibration implies (centre between the taps, size 1.18x their spread). Samples whose
// darts then fall outside the board are dropped. The output uses the same layout and classes as
// scripts/build-yolo-dataset.mjs: 0 dart, 1..4 cal_1..cal_4 (known exactly in the rectified frame).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const [, , datasetFile, tapsFile, outDir] = process.argv;
if (!datasetFile || !tapsFile || !outDir) {
  console.error("Usage: node scripts/training/legacy-to-rectified.mjs <training-dataset.json> <taps.json> <output-dir>");
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));
const sharp = require("sharp");

// Reuse the app's own geometry instead of copying it.
const bundleFile = path.join(root, "node_modules", ".cache-legacy-to-rectified.mjs");
await build({
  stdin: {
    contents: `export * from "./src/utils/boardRectify"; export { computeCropRect, MODEL_CORNERS_CANON, scoreFromCanonicalPoint } from "./src/utils/cameraGeometry"; export { applyHomography } from "./src/utils/homography";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true, format: "esm", outfile: bundleFile, logLevel: "error",
});
const geo = await import(pathToFileURL(bundleFile).href);
fs.rmSync(bundleFile, { force: true });

const DART_BOX = 0.05, CORNER_BOX = 0.05, VAL_PERCENT = 15;
const VW = 720, VH = 1280, SIZE = 800;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = (v) => clamp(v, 0, 1);
const isValidation = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 100 < VAL_PERCENT;

const tapsById = new Map(JSON.parse(fs.readFileSync(tapsFile, "utf8")).filter((r) => Array.isArray(r.calib_taps) && r.calib_taps.length === 4).map((r) => [r.id, r.calib_taps]));
const { samples } = JSON.parse(fs.readFileSync(datasetFile, "utf8"));

for (const split of ["train", "val"]) {
  fs.mkdirSync(path.join(outDir, "images", split), { recursive: true });
  fs.mkdirSync(path.join(outDir, "labels", split), { recursive: true });
}

const bilinear = (buf, w, h, px, py, out, o) => {
  if (px < 0 || py < 0 || px > w - 1 || py > h - 1) { out[o] = out[o + 1] = out[o + 2] = 43; return; }
  const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), tx = px - x0, ty = py - y0;
  for (let c = 0; c < 3; c++) {
    out[o + c] = (buf[(y0 * w + x0) * 3 + c] * (1 - tx) + buf[(y0 * w + x1) * 3 + c] * tx) * (1 - ty)
      + (buf[(y1 * w + x0) * 3 + c] * (1 - tx) + buf[(y1 * w + x1) * 3 + c] * tx) * ty;
  }
};

const counts = { train: 0, val: 0, noTaps: 0, noDarts: 0, droppedDarts: 0 };
for (const sample of samples) {
  const taps = tapsById.get(sample.id);
  if (!taps) { counts.noTaps++; continue; }
  const cx0 = (taps[2].x + taps[3].x) / 2, cy0 = (taps[0].y + taps[1].y) / 2;
  const spread = Math.max(Math.abs(taps[3].x - taps[2].x), Math.abs(taps[1].y - taps[0].y));
  const rect = geo.computeCropRect(VW, VH, clamp(cx0, 0.15, 0.85), clamp(cy0, 0.15, 0.85), clamp(spread * 1.18, 0.55, 0.98));
  const mapping = geo.rectifyMappingFromTaps(taps);
  if (!rect || !mapping) continue;

  // darts: crop fractions -> camera video -> rectified frame; keep those on the board
  const darts = [];
  for (const d of sample.darts) {
    if (d.snapped) { counts.droppedDarts++; continue; }
    const v = { x: (rect.sx + d.x * rect.side) / VW, y: (rect.sy + d.y * rect.side) / VH };
    const p = geo.applyHomography(mapping.videoToRect, v);
    const canon = geo.rectToCanonical(p.x, p.y);
    if (Math.hypot(canon.x, canon.y) > 1.2 || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) { counts.droppedDarts++; continue; }
    darts.push(p);
  }
  if (darts.length === 0) { counts.noDarts++; continue; }

  const crop = await sharp(Buffer.from(sample.image.slice(sample.image.indexOf(",") + 1), "base64")).resize(420, 420, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const rgb = Buffer.alloc(SIZE * SIZE * 3);
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = mapping.rectToVideo;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const fx = (x + 0.5) / SIZE, fy = (y + 0.5) / SIZE, w = h6 * fx + h7 * fy + h8;
    const vx = (h0 * fx + h1 * fy + h2) / w, vy = (h3 * fx + h4 * fy + h5) / w;
    bilinear(crop, 420, 420, ((vx * VW - rect.sx) / rect.side) * 420 - 0.5, ((vy * VH - rect.sy) / rect.side) * 420 - 0.5, rgb, (y * SIZE + x) * 3);
  }

  const split = isValidation(sample.id) ? "val" : "train";
  await sharp(rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } }).jpeg({ quality: 93 }).toFile(path.join(outDir, "images", split, `${sample.id}.jpg`));
  const lines = darts.map((p) => `0 ${clamp01(p.x).toFixed(6)} ${clamp01(p.y).toFixed(6)} ${DART_BOX} ${DART_BOX}`);
  geo.MODEL_CORNERS_CANON.forEach((c, i) => {
    const p = geo.canonicalToRect(c.x, c.y);
    lines.push(`${i + 1} ${p.x.toFixed(6)} ${p.y.toFixed(6)} ${CORNER_BOX} ${CORNER_BOX}`);
  });
  fs.writeFileSync(path.join(outDir, "labels", split, `${sample.id}.txt`), lines.join("\n") + "\n");
  counts[split]++;
}

fs.writeFileSync(
  path.join(outDir, "data.yaml"),
  ["path: .", "train: images/train", "val: images/val", "names:", "  0: dart", "  1: cal_1", "  2: cal_2", "  3: cal_3", "  4: cal_4", ""].join("\n"),
);
console.log(`Wrote ${counts.train} train / ${counts.val} val rectified samples to ${outDir} (skipped: ${counts.noTaps} without calibration, ${counts.noDarts} without usable darts; ${counts.droppedDarts} darts dropped)`);
