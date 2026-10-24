// Gives the training split more weight on the cases the model is weakest at, by writing extra copies of those images.
//
//   node scripts/training/weight-hard-samples.mjs <dataset-dir>
//
// Measured on the player's own rounds (batches of 2026-10-24): the model misses darts in the double ring (4 of 5), the
// treble ring and near the outer edge far more often than darts in the single fields, and more on the lower-left side
// of the board. Such images are copied (train split only, the validation images stay untouched so the numbers stay honest):
//   - a dart in the double ring or beyond (r > 0.93)        -> 2 extra copies
//   - a dart in the treble ring or near the edge (0.57-0.66 or 0.88-0.93) -> 1 extra copy
//   - a dart on the lower-left side AND in the outer half of the board (r > 0.6) -> 1 extra copy
// An image gets the largest bonus of its darts, at most 2 extra copies.
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("Usage: node scripts/training/weight-hard-samples.mjs <dataset-dir>"); process.exit(1); }
const RADIUS = 0.377; // board radius in the straightened frame (fraction of the width)
const labelDir = path.join(dir, "labels", "train"), imageDir = path.join(dir, "images", "train");
const stats = { images: 0, copies: 0, double: 0, ringOrEdge: 0, lowerLeft: 0 };
for (const file of fs.readdirSync(labelDir)) {
  if (/_w\d\.txt$/.test(file)) continue; // never weight a copy again when the script is run twice
  const darts = fs.readFileSync(path.join(labelDir, file), "utf8").trim().split("\n").map((l) => l.split(" ").map(Number)).filter((l) => l[0] === 0);
  let extra = 0, isDouble = false, isRing = false, isLL = false;
  for (const [, x, y] of darts) {
    const r = Math.hypot(x - 0.5, y - 0.5) / RADIUS;
    if (r > 0.93) { extra = Math.max(extra, 2); isDouble = true; }
    else if ((r > 0.57 && r < 0.66) || r > 0.88) { extra = Math.max(extra, 1); isRing = true; }
    if (x < 0.5 && y > 0.5 && r > 0.6) { extra = Math.max(extra, 1); isLL = true; }
  }
  stats.images++; if (isDouble) stats.double++; if (isRing) stats.ringOrEdge++; if (isLL) stats.lowerLeft++;
  const base = file.replace(/\.txt$/, "");
  for (let k = 1; k <= extra; k++) {
    fs.copyFileSync(path.join(labelDir, file), path.join(labelDir, `${base}_w${k}.txt`));
    fs.copyFileSync(path.join(imageDir, `${base}.jpg`), path.join(imageDir, `${base}_w${k}.jpg`));
    stats.copies++;
  }
}
console.log(`${stats.images} training images: ${stats.double} with a double-ring dart, ${stats.ringOrEdge} with a treble/edge dart, ${stats.lowerLeft} with a lower-left dart -> ${stats.copies} extra copies written`);
