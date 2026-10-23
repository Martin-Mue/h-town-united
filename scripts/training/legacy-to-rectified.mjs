// Converts the OLD training samples (plain 420px crops, saved before the board was straightened) into
// the RECTIFIED frame the app now feeds the model, so they can be used for training right away.
//
//   node scripts/training/legacy-to-rectified.mjs <taps.json> <output-dir> <samples-dir> [<samples-dir> ...]
//
// <taps.json>      rows of training_samples.calib_taps — [{ "id": "...", "calib_taps": [{x,y} x4] }, ...] or
//                  { "rows": [...] } as the database tool returns them
// <samples-dir>    folders that contain one sub-folder per sample with after.jpg + meta.json (as written by
//                  scripts/unpack-training-batch.mjs); searched two levels deep
//
// What it does for every sample:
//  1. rebuilds where the 420px crop sat in the camera picture (the crop rule of the app at the time),
//  2. re-fits the saved calibration onto the board's real wires in that picture (src/utils/boardWireFit.ts)
//     — the hand-placed taps were 7 mm off on average, which would blur every label —,
//  3. straightens the crop into the 800px frame (same code path as the app: boardRectify.ts),
//  4. maps each confirmed dart tip into that frame and writes the four corner classes at their exact
//     positions (known once the board is straightened).
// Samples whose board cannot be found in the picture or whose darts leave the board are skipped and counted.
// Output layout/classes match scripts/build-yolo-dataset.mjs: 0 dart, 1..4 cal_1..cal_4.
//
// Assumption, checked against real data: the camera picture was PORTRAIT 720x1280 (then all four saved
// calibration points land on the double ring's top/bottom/left/right in the crop).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(name + "="));
  return hit ? Number(hit.split("=")[1]) : fallback;
};
const [tapsFile, outDir, ...sampleDirs] = args.filter((a) => !a.startsWith("--"));
if (!tapsFile || !outDir || sampleDirs.length === 0) {
  console.error("Usage: node scripts/training/legacy-to-rectified.mjs <taps.json> <output-dir> <samples-dir> [<samples-dir> ...] [--dart-box=0.06] [--corner-box=0.05]");
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));
const sharp = require("sharp");
const { build } = require("esbuild");

// Reuse the app's own geometry instead of copying it.
const bundleFile = path.join(root, "node_modules", ".cache-legacy-to-rectified.mjs");
await build({
  stdin: {
    contents: `export * from "./src/utils/boardRectify"; export { computeCropRect, MODEL_CORNERS_CANON } from "./src/utils/cameraGeometry"; export { applyHomography } from "./src/utils/homography"; export { prepareWireFit, refineTapsToWires, WIRE_FIT_CONFIDENT } from "./src/utils/boardWireFit";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true, format: "esm", outfile: bundleFile, logLevel: "error",
});
const geo = await import(pathToFileURL(bundleFile).href);
fs.rmSync(bundleFile, { force: true });

const DART_BOX = option("--dart-box", 0.06), CORNER_BOX = option("--corner-box", 0.05), VAL_PERCENT = 15;
const VW = 720, VH = 1280, SIZE = 800, CROP_PX = 420;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = (v) => clamp(v, 0, 1);
const isValidation = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 100 < VAL_PERCENT;

const tapRows = JSON.parse(fs.readFileSync(tapsFile, "utf8"));
const tapsById = new Map((Array.isArray(tapRows) ? tapRows : tapRows.rows).filter((r) => Array.isArray(r.calib_taps) && r.calib_taps.length === 4).map((r) => [r.id, r.calib_taps]));

const sampleFolders = [];
for (const dir of sampleDirs) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(dir, entry.name);
    if (fs.existsSync(path.join(sub, "meta.json"))) sampleFolders.push(sub);
    else for (const inner of fs.readdirSync(sub, { withFileTypes: true })) {
      if (inner.isDirectory() && fs.existsSync(path.join(sub, inner.name, "meta.json"))) sampleFolders.push(path.join(sub, inner.name));
    }
  }
}

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

const counts = { train: 0, val: 0, noTaps: 0, noBoard: 0, noDarts: 0, droppedDarts: 0, keptDarts: 0 };
for (const folder of sampleFolders) {
  const meta = JSON.parse(fs.readFileSync(path.join(folder, "meta.json"), "utf8"));
  const taps = tapsById.get(meta.id);
  if (!taps) { counts.noTaps++; continue; }
  const labels = (meta.labels ?? []).filter((l) => typeof l.x === "number" && typeof l.y === "number" && l.baseValue >= 0 && !l.snapped);
  counts.droppedDarts += (meta.labels ?? []).length - labels.length;
  if (labels.length === 0) { counts.noDarts++; continue; }

  // where the crop sat in the camera picture
  const cx0 = (taps[2].x + taps[3].x) / 2, cy0 = (taps[0].y + taps[1].y) / 2;
  const spread = Math.max(Math.abs(taps[3].x - taps[2].x), Math.abs(taps[1].y - taps[0].y));
  const rect = geo.computeCropRect(VW, VH, clamp(cx0, 0.15, 0.85), clamp(cy0, 0.15, 0.85), clamp(spread * 1.18, 0.55, 0.98));
  if (!rect) continue;

  const crop = await sharp(path.join(folder, "after.jpg")).resize(CROP_PX, CROP_PX, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(CROP_PX * CROP_PX * 4);
  for (let i = 0; i < CROP_PX * CROP_PX; i++) { rgba[i * 4] = crop[i * 3]; rgba[i * 4 + 1] = crop[i * 3 + 1]; rgba[i * 4 + 2] = crop[i * 3 + 2]; rgba[i * 4 + 3] = 255; }

  // re-fit the calibration onto the wires (in crop space), then express it as camera-picture fractions again
  const tapsInCrop = taps.map((t) => ({ x: (t.x * VW - rect.sx) / rect.side, y: (t.y * VH - rect.sy) / rect.side }));
  const fit = geo.refineTapsToWires(geo.prepareWireFit({ data: rgba, width: CROP_PX, height: CROP_PX }), tapsInCrop);
  if (!fit || fit.quality < geo.WIRE_FIT_CONFIDENT) { counts.noBoard++; continue; }
  const fittedTaps = fit.taps.map((t) => ({ x: (rect.sx + t.x * rect.side) / VW, y: (rect.sy + t.y * rect.side) / VH }));
  const mapping = geo.rectifyMappingFromTaps(fittedTaps);
  if (!mapping) { counts.noBoard++; continue; }

  // darts: crop fractions -> camera picture -> straightened frame; keep those on the board
  const darts = [];
  for (const d of labels) {
    const v = { x: (rect.sx + d.x * rect.side) / VW, y: (rect.sy + d.y * rect.side) / VH };
    const p = geo.applyHomography(mapping.videoToRect, v);
    const canon = geo.rectToCanonical(p.x, p.y);
    if (Math.hypot(canon.x, canon.y) > 1.2 || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) { counts.droppedDarts++; continue; }
    darts.push(p);
  }
  if (darts.length === 0) { counts.noDarts++; continue; }
  counts.keptDarts += darts.length;

  const rgb = Buffer.alloc(SIZE * SIZE * 3);
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = mapping.rectToVideo;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const fx = (x + 0.5) / SIZE, fy = (y + 0.5) / SIZE, w = h6 * fx + h7 * fy + h8;
    const vx = (h0 * fx + h1 * fy + h2) / w, vy = (h3 * fx + h4 * fy + h5) / w;
    bilinear(crop, CROP_PX, CROP_PX, ((vx * VW - rect.sx) / rect.side) * CROP_PX - 0.5, ((vy * VH - rect.sy) / rect.side) * CROP_PX - 0.5, rgb, (y * SIZE + x) * 3);
  }

  const split = isValidation(meta.id) ? "val" : "train";
  await sharp(rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } }).jpeg({ quality: 93 }).toFile(path.join(outDir, "images", split, `${meta.id}.jpg`));
  const lines = darts.map((p) => `0 ${clamp01(p.x).toFixed(6)} ${clamp01(p.y).toFixed(6)} ${DART_BOX} ${DART_BOX}`);
  geo.MODEL_CORNERS_CANON.forEach((c, i) => {
    const p = geo.canonicalToRect(c.x, c.y);
    lines.push(`${i + 1} ${p.x.toFixed(6)} ${p.y.toFixed(6)} ${CORNER_BOX} ${CORNER_BOX}`);
  });
  fs.writeFileSync(path.join(outDir, "labels", split, `${meta.id}.txt`), lines.join("\n") + "\n");
  counts[split]++;
}

fs.writeFileSync(
  path.join(outDir, "data.yaml"),
  ["path: .", "train: images/train", "val: images/val", "names:", "  0: dart", "  1: cal_1", "  2: cal_2", "  3: cal_3", "  4: cal_4", ""].join("\n"),
);
console.log(`Wrote ${counts.train} train / ${counts.val} val rectified samples (${counts.keptDarts} darts) to ${outDir}`);
console.log(`Skipped: ${counts.noTaps} without saved calibration, ${counts.noBoard} board not found, ${counts.noDarts} without usable darts; ${counts.droppedDarts} single darts dropped`);
