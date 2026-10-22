// Unpacks a batch exported from Admin -> KI-Trainer -> "Batch exportieren" into one folder per
// sample (before.jpg, after.jpg, meta.json) so the images can be viewed and judged one by one.
// Usage: node scripts/unpack-training-batch.mjs <training-batch-file.json> <output-dir>
import fs from "node:fs";
import path from "node:path";

const [, , inputFile, outDir] = process.argv;
if (!inputFile || !outDir) {
  console.error("Usage: node scripts/unpack-training-batch.mjs <batch.json> <output-dir>");
  process.exit(1);
}

const { samples } = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const saveDataUrl = (dataUrl, target) =>
  fs.writeFileSync(target, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));

samples.forEach((sample, i) => {
  const dir = path.join(outDir, `${String(i + 1).padStart(3, "0")}_${sample.id.slice(0, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  saveDataUrl(sample.before, path.join(dir, "before.jpg"));
  saveDataUrl(sample.after, path.join(dir, "after.jpg"));
  const { before, after, ...meta } = sample;
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
});
console.log(`Unpacked ${samples.length} samples into ${outDir}`);
