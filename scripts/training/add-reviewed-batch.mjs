// Adds a reviewed batch from Admin -> KI-Trainer (already straightened 800px frames) to a YOLO dataset.
//
//   node scripts/training/add-reviewed-batch.mjs <batch.json> <reviewed-labels.json> <dataset-dir> [--dart-box=0.04] [--corner-box=0.05]
//
// The labels are the darts the player confirmed, corrected/completed by the review file. The four corner
// classes are put where the board's wires really are in each frame: the calibration the frame was straightened
// with is a few millimetres off at times, so the picture is fitted first (src/utils/boardWireFit.ts).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => { const hit = args.find((a) => a.startsWith(name + "=")); return hit ? Number(hit.split("=")[1]) : fallback; };
const [batchFile, reviewFile, outDir] = args.filter((a) => !a.startsWith("--"));
if (!batchFile || !reviewFile || !outDir) {
  console.error("Usage: node scripts/training/add-reviewed-batch.mjs <batch.json> <reviewed-labels.json> <dataset-dir> [--dart-box=0.04] [--corner-box=0.05]");
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));
const sharp = require("sharp");
const { build } = require("esbuild");
const bundleFile = path.join(root, "node_modules", ".cache-add-reviewed-batch.mjs");
await build({
  stdin: {
    contents: `export { canonicalToRect, rectToCanonical } from "./src/utils/boardRectify"; export { MODEL_CORNERS_CANON } from "./src/utils/cameraGeometry"; export { applyHomography, computeHomography } from "./src/utils/homography"; export { CANON_BOARD_POINTS } from "./src/utils/cameraGeometry"; export { prepareWireFit, refineTapsToWires, WIRE_FIT_CONFIDENT } from "./src/utils/boardWireFit";`,
    resolveDir: root, loader: "ts",
  },
  bundle: true, format: "esm", outfile: bundleFile, logLevel: "error",
});
const geo = await import(pathToFileURL(bundleFile).href);
fs.rmSync(bundleFile, { force: true });

const DART_BOX = option("--dart-box", 0.04), CORNER_BOX = option("--corner-box", 0.05), VAL_PERCENT = 15, SIZE = 800;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const isValidation = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 100 < VAL_PERCENT;
const { samples } = JSON.parse(fs.readFileSync(batchFile, "utf8"));
const review = JSON.parse(fs.readFileSync(reviewFile, "utf8")).samples;
for (const split of ["train", "val"]) {
  fs.mkdirSync(path.join(outDir, "images", split), { recursive: true });
  fs.mkdirSync(path.join(outDir, "labels", split), { recursive: true });
}

// where the straightening put the four taps (ideal positions), as picture fractions
const idealTaps = geo.CANON_BOARD_POINTS.map((p) => geo.canonicalToRect(p.x, p.y));
const counts = { train: 0, val: 0, noDarts: 0, noFit: 0, darts: 0, shifts: [] };
for (const [index, sample] of samples.entries()) {
  const number = String(index + 1).padStart(3, "0");
  const decision = review[number] ?? {};
  if (decision.exclude) { console.log(`  sample ${number}: excluded (${decision.exclude})`); counts.noDarts++; continue; }
  const remove = new Set(decision.removeLabels ?? []);
  const darts = (sample.labels ?? [])
    .filter((l, i) => typeof l.x === "number" && typeof l.y === "number" && l.baseValue >= 0 && !l.snapped && !remove.has(i + 1))
    .map((l) => ({ x: l.x, y: l.y }))
    .concat((decision.add ?? []).map(([x, y]) => ({ x, y })));
  if (darts.length === 0) { counts.noDarts++; continue; }

  const jpeg = Buffer.from(sample.after.slice(sample.after.indexOf(",") + 1), "base64");
  const raw = await sharp(jpeg).resize(SIZE, SIZE, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) { rgba[i * 4] = raw[i * 3]; rgba[i * 4 + 1] = raw[i * 3 + 1]; rgba[i * 4 + 2] = raw[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  const fit = geo.refineTapsToWires(geo.prepareWireFit({ data: rgba, width: SIZE, height: SIZE }), idealTaps);
  if (!fit || fit.quality < geo.WIRE_FIT_CONFIDENT) { counts.noFit++; console.log(`  sample ${number} (${sample.id.slice(0, 8)}): board not found in the frame, skipped`); continue; }
  const shiftMm = Math.max(...fit.taps.map((t, i) => Math.hypot((t.x - idealTaps[i].x) * SIZE, (t.y - idealTaps[i].y) * SIZE))) * (170 / (0.377 * SIZE));
  counts.shifts.push(shiftMm);
  if (shiftMm > 15) console.log(`  sample ${number} (${sample.id.slice(0, 8)}): board sits ${shiftMm.toFixed(0)} mm off the ideal position, fit quality ${fit.quality.toFixed(2)}`);
  const H = geo.computeHomography(geo.CANON_BOARD_POINTS, fit.taps.map((t) => ({ x: t.x, y: t.y })));
  const split = isValidation(sample.id) ? "val" : "train";
  fs.writeFileSync(path.join(outDir, "images", split, `${sample.id}.jpg`), jpeg);
  const lines = darts.map((p) => `0 ${clamp01(p.x).toFixed(6)} ${clamp01(p.y).toFixed(6)} ${DART_BOX} ${DART_BOX}`);
  geo.MODEL_CORNERS_CANON.forEach((c, i) => {
    const p = geo.applyHomography(H, c);
    // a corner that lies outside the frame (the board was cut off) gets no label instead of a wrong one
    if (p.x > 0.02 && p.x < 0.98 && p.y > 0.02 && p.y < 0.98) lines.push(`${i + 1} ${p.x.toFixed(6)} ${p.y.toFixed(6)} ${CORNER_BOX} ${CORNER_BOX}`);
  });
  fs.writeFileSync(path.join(outDir, "labels", split, `${sample.id}.txt`), lines.join("\n") + "\n");
  counts[split]++; counts.darts += darts.length;
}
const shifts = counts.shifts.sort((a, b) => a - b);
console.log(`Added ${counts.train} train / ${counts.val} val samples (${counts.darts} darts) to ${outDir}; skipped ${counts.noDarts} without darts, ${counts.noFit} where the board could not be fitted`);
if (shifts.length) console.log(`Board position in these frames vs. the ideal straightened position: median ${shifts[shifts.length >> 1].toFixed(1)} mm, max ${shifts[shifts.length - 1].toFixed(1)} mm`);
