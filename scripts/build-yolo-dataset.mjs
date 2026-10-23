// Turns the file from Admin -> KI-Trainer -> "Trainingsset exportieren" into a YOLOv8 dataset:
//   <out>/images/{train,val}/*.jpg, <out>/labels/{train,val}/*.txt, <out>/data.yaml
//
// Classes: 0 dart, 1..4 cal_1..cal_4 (the board's four corner points, same meaning as in the shipped
// model: top, bottom, left, right wire crossing of the outer double ring).
//
// Only samples taken in the RECTIFIED frame (the board straightened by src/utils/boardRectify.ts, saved
// with calibration_meta.frame === "rectified") are used by default: their corners are known exactly
// (calibration_meta.modelCorners), so all five classes get real labels, and every picture looks the same
// whatever the camera angle. Older plain-crop samples have no corner labels (a model trained on them
// would learn "no corners here") and a different look — add them with --include-legacy only for a
// dart-only experiment. Samples with a dart the player corrected via the chips (snapped) carry a field
// centre instead of a measured tip and are skipped unless --include-snapped.
//
// Usage: node scripts/build-yolo-dataset.mjs <training-dataset.json> <output-dir> [--include-legacy] [--include-snapped] [--dart-box=0.025] [--corner-box=0.05]
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(name + "="));
  return hit ? Number(hit.split("=")[1]) : fallback;
};
const [inputFile, outDir] = positional;
if (!inputFile || !outDir) {
  console.error("Usage: node scripts/build-yolo-dataset.mjs <training-dataset.json> <output-dir> [--include-legacy] [--include-snapped] [--dart-box=0.025] [--corner-box=0.05]");
  process.exit(1);
}
const dartBox = option("--dart-box", 0.025);
const cornerBox = option("--corner-box", 0.05);
const VAL_PERCENT = 15;
const clamp01 = (v) => Math.min(1, Math.max(0, v)); // YOLO drops images whose labels leave 0..1

const { samples } = JSON.parse(fs.readFileSync(inputFile, "utf8"));

// Deterministic split by id, so re-running with more data never moves a sample between sets.
const isValidation = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 100 < VAL_PERCENT;

for (const split of ["train", "val"]) {
  fs.mkdirSync(path.join(outDir, "images", split), { recursive: true });
  fs.mkdirSync(path.join(outDir, "labels", split), { recursive: true });
}

const counts = { train: 0, val: 0, skippedLegacy: 0, skippedSnapped: 0, rectified: 0, legacy: 0 };
for (const sample of samples) {
  const meta = sample.calibration_meta;
  const rectified = meta?.frame === "rectified" && Array.isArray(meta.modelCorners) && meta.modelCorners.length === 4;
  if (!rectified && !flag("--include-legacy")) { counts.skippedLegacy++; continue; }
  if (!flag("--include-snapped") && sample.darts.some((d) => d.snapped)) { counts.skippedSnapped++; continue; }

  const split = isValidation(sample.id) ? "val" : "train";
  const comma = sample.image.indexOf(",");
  fs.writeFileSync(path.join(outDir, "images", split, `${sample.id}.jpg`), Buffer.from(sample.image.slice(comma + 1), "base64"));
  const lines = sample.darts.map((d) => `0 ${clamp01(d.x).toFixed(6)} ${clamp01(d.y).toFixed(6)} ${dartBox} ${dartBox}`);
  if (rectified) {
    meta.modelCorners.forEach((c, i) => lines.push(`${i + 1} ${clamp01(c.x).toFixed(6)} ${clamp01(c.y).toFixed(6)} ${cornerBox} ${cornerBox}`));
    counts.rectified++;
  } else {
    counts.legacy++;
  }
  fs.writeFileSync(path.join(outDir, "labels", split, `${sample.id}.txt`), lines.join("\n") + "\n");
  counts[split]++;
}

fs.writeFileSync(
  path.join(outDir, "data.yaml"),
  ["path: .", "train: images/train", "val: images/val", "names:", "  0: dart", "  1: cal_1", "  2: cal_2", "  3: cal_3", "  4: cal_4", ""].join("\n"),
);
console.log(`Wrote ${counts.train} train / ${counts.val} val samples to ${outDir} (rectified ${counts.rectified}, legacy ${counts.legacy}; skipped: ${counts.skippedLegacy} legacy, ${counts.skippedSnapped} with chip-corrected darts)`);
