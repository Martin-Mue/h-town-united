// Turns the file from Admin -> KI-Trainer -> "Trainingsset exportieren" into a YOLOv8 dataset:
//   <out>/images/{train,val}/*.jpg, <out>/labels/{train,val}/*.txt, <out>/data.yaml
// Only the `dart` class is exported. The model's cal_1..cal_4 corner classes stay out on purpose:
// the stored calibration taps are in video coordinates, not in the cropped frame the training
// images show, so mapping them would silently mislabel the corners.
// Usage: node scripts/build-yolo-dataset.mjs <training-dataset.json> <output-dir> [boxSize=0.025]
// boxSize matches how the current model was trained (small box centred on the dart tip, ~2.5% of
// the image) — see src/utils/dartModel.ts.
import fs from "node:fs";
import path from "node:path";

const [, , inputFile, outDir, boxArg] = process.argv;
if (!inputFile || !outDir) {
  console.error("Usage: node scripts/build-yolo-dataset.mjs <training-dataset.json> <output-dir> [boxSize]");
  process.exit(1);
}
const boxSize = Number(boxArg ?? 0.025);
const VAL_PERCENT = 15;

const { samples } = JSON.parse(fs.readFileSync(inputFile, "utf8"));

// Deterministic split by id, so re-running with more data never moves a sample between sets.
const isValidation = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 100 < VAL_PERCENT;

for (const split of ["train", "val"]) {
  fs.mkdirSync(path.join(outDir, "images", split), { recursive: true });
  fs.mkdirSync(path.join(outDir, "labels", split), { recursive: true });
}

const counts = { train: 0, val: 0 };
for (const sample of samples) {
  const split = isValidation(sample.id) ? "val" : "train";
  const comma = sample.image.indexOf(",");
  fs.writeFileSync(path.join(outDir, "images", split, `${sample.id}.jpg`), Buffer.from(sample.image.slice(comma + 1), "base64"));
  const clamp01 = (v) => Math.min(1, Math.max(0, v)); // YOLO drops images whose labels leave 0..1
  const lines = sample.darts.map((d) => `0 ${clamp01(d.x).toFixed(6)} ${clamp01(d.y).toFixed(6)} ${boxSize} ${boxSize}`);
  fs.writeFileSync(path.join(outDir, "labels", split, `${sample.id}.txt`), lines.join("\n") + "\n");
  counts[split] += 1;
}

fs.writeFileSync(
  path.join(outDir, "data.yaml"),
  ["path: .", "train: images/train", "val: images/val", "names:", "  0: dart", ""].join("\n"),
);
console.log(`Wrote ${counts.train} train / ${counts.val} val samples to ${outDir}`);
