// Builds the YOLO training set from everything we have, with the hand-checked labels as truth:
//
//   npx tsx scripts/training/build-training-set.mts <dataset-export.json> <out-dir> [--batches=<dir with training-batch-*.json>] [--synthetic=<dir>] [--val-percent=40]
//
//  * pictures: the dataset export (all confirmed samples) plus every training-batch-*.json of the given folder (samples that
//    were checked by hand but are not in the export yet); the first occurrence of an id wins
//  * labels: ai-verdicts-*.json (sorted by name, later files win) replace the stored dart positions; "rejected" removes a sample.
//    Samples whose darts were only picked from the correction chips (field centres, not tips) are left out unless hand-checked
//  * every picture is re-straightened with the wire fit (like realign-training-set.mts); the four corner classes then sit at
//    their ideal places. A picture whose fit fails is dropped (without a measured corner the label would be a guess)
//  * split: hand-checked samples go to val with --val-percent % (by a hash of the id, so re-runs never move a sample); every
//    other sample trains. The val set is therefore HONEST: labels checked on the picture, not derived from a model
//  * the cases the model is weakest at (double ring, treble, edge, lower left) get extra copies in train (weight-hard-samples.mjs)
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { prepareWireFit, refineTapsToWires } from "../../src/utils/boardWireFit.ts";
import { rectifyMappingFromTaps, warpToRectified, canonicalToRect } from "../../src/utils/boardRectify.ts";
import { CANON_BOARD_POINTS, MODEL_CORNERS_CANON } from "../../src/utils/cameraGeometry.ts";
import { applyHomography } from "../../src/utils/homography.ts";

const req = createRequire(import.meta.url);
const sharp = req("sharp");
const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const [exportFile, outDir] = args.filter((a) => !a.startsWith("--"));
if (!exportFile || !outDir) { console.error("Usage: npx tsx scripts/training/build-training-set.mts <dataset-export.json> <out-dir> [--batches=<dir>] [--synthetic=<dir>] [--val-percent=40]"); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
const VAL_PERCENT = Number(opt("val-percent", "40"));
const DART_BOX = 0.04, CORNER_BOX = 0.05, SIZE = 800;
const MM = 170 / (0.377 * SIZE), MAX_MOVE_MM = 15;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const hashPct = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 100;

// ── pictures ──
type Pic = { id: string; image: string; darts: { x: number; y: number; snapped?: boolean }[]; meta: any };
const pics = new Map<string, Pic>();
const exp = JSON.parse(fs.readFileSync(exportFile, "utf8"));
for (const s of exp.samples) pics.set(s.id, { id: s.id, image: s.image, darts: s.darts ?? [], meta: s.calibration_meta });
const batchDir = opt("batches", "");
let fromBatches = 0;
if (batchDir) {
  for (const f of fs.readdirSync(batchDir).filter((f) => /^training-batch-.*\.json$/.test(f))) {
    const j = JSON.parse(fs.readFileSync(path.join(batchDir, f), "utf8"));
    for (const s of j.samples ?? []) {
      if (pics.has(s.id)) continue;
      const labels = (typeof s.labels === "string" ? JSON.parse(s.labels) : s.labels).filter((l: any) => typeof l.x === "number");
      pics.set(s.id, { id: s.id, image: s.after, darts: labels.map((l: any) => ({ x: l.x, y: l.y, snapped: !!l.snapped })), meta: null });
      fromBatches++;
    }
  }
}

// ── hand-checked labels ──
const verdictDir = here;
const checked = new Map<string, { x: number; y: number }[] | "rejected">();
for (const f of fs.readdirSync(verdictDir).filter((f) => /^ai-verdicts-.*\.json$/.test(f)).sort()) {
  for (const v of JSON.parse(fs.readFileSync(path.join(verdictDir, f), "utf8"))) {
    if (v.status === "rejected") checked.set(v.id, "rejected");
    else if (Array.isArray(v.labels)) checked.set(v.id, v.labels.map((l: any) => ({ x: l.x, y: l.y })));
  }
}

// ── wire fit ──
const ideal = CANON_BOARD_POINTS.map((p: any) => canonicalToRect(p.x, p.y));
const idealCorners = MODEL_CORNERS_CANON.map((p: any) => canonicalToRect(p.x, p.y));
for (const split of ["train", "val"]) for (const sub of ["images", "labels"]) fs.mkdirSync(path.join(outDir, sub, split), { recursive: true });
const stats = { train: 0, val: 0, rejected: 0, snappedSkipped: 0, fitFailed: 0, tooFar: 0, noDarts: 0, doublesTrain: 0, doublesVal: 0, darts: 0 };
const moves: number[] = [];
const R = 0.377;
const isDouble = (x: number, y: number) => { const r = Math.hypot(x - 0.5, y - 0.5) / R; return r > 0.953 && r <= 1.0; };

for (const pic of pics.values()) {
  const truth = checked.get(pic.id);
  if (truth === "rejected") { stats.rejected++; continue; }
  const darts = truth ?? pic.darts;
  if (!truth && pic.darts.some((d) => d.snapped)) { stats.snappedSkipped++; continue; }
  if (darts.length === 0) { stats.noDarts++; continue; }
  const buf = Buffer.from(pic.image.slice(pic.image.indexOf(",") + 1), "base64");
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== SIZE || info.height !== SIZE) { stats.fitFailed++; continue; }
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) { rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  const fit = refineTapsToWires(prepareWireFit({ data: rgba, width: SIZE, height: SIZE }), ideal);
  if (!fit || fit.quality < 0.45) { stats.fitFailed++; continue; }
  const moveMm = Math.max(...fit.taps.map((p: any, i: number) => Math.hypot(p.x - ideal[i].x, p.y - ideal[i].y) * SIZE * MM));
  if (moveMm > MAX_MOVE_MM) { stats.tooFar++; continue; }
  moves.push(moveMm);
  const mapping = rectifyMappingFromTaps(fit.taps)!;
  const out = warpToRectified({ data: rgba, width: SIZE, height: SIZE }, mapping.rectToVideo, SIZE);
  const rgb = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) { rgb[i * 3] = out.data[i * 4]; rgb[i * 3 + 1] = out.data[i * 4 + 1]; rgb[i * 3 + 2] = out.data[i * 4 + 2]; }
  const lines: string[] = [];
  for (const d of darts) { const p = applyHomography(mapping.videoToRect, { x: d.x, y: d.y }); lines.push(`0 ${clamp01(p.x).toFixed(6)} ${clamp01(p.y).toFixed(6)} ${DART_BOX} ${DART_BOX}`); }
  idealCorners.forEach((c: any, i: number) => lines.push(`${i + 1} ${c.x.toFixed(6)} ${c.y.toFixed(6)} ${CORNER_BOX} ${CORNER_BOX}`));
  const split = truth && hashPct(pic.id) < VAL_PERCENT ? "val" : "train";
  await sharp(rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } }).jpeg({ quality: 90 }).toFile(path.join(outDir, "images", split, `${pic.id}.jpg`));
  fs.writeFileSync(path.join(outDir, "labels", split, `${pic.id}.txt`), lines.join("\n") + "\n");
  stats[split]++; stats.darts += darts.length;
  const dbl = darts.some((d) => { const p = applyHomography(mapping.videoToRect, { x: d.x, y: d.y }); return isDouble(p.x, p.y); });
  if (dbl) { if (split === "train") stats.doublesTrain++; else stats.doublesVal++; }
}

// ── synthetic edge/double darts (train only) ──
const synDir = opt("synthetic", "");
let synthetic = 0;
if (synDir) {
  const imgDir = path.join(synDir, "images", "train"), lblDir = path.join(synDir, "labels", "train");
  for (const f of fs.readdirSync(imgDir).filter((f) => /^syn\d+\.jpg$/.test(f))) {
    fs.copyFileSync(path.join(imgDir, f), path.join(outDir, "images", "train", f));
    fs.copyFileSync(path.join(lblDir, f.replace(/\.jpg$/, ".txt")), path.join(outDir, "labels", "train", f.replace(/\.jpg$/, ".txt")));
    synthetic++;
  }
}
// ── older samples that only exist as 420 px crops: take them from an earlier straightened set (v8), train only ──
const legacyDir = opt("legacy", "");
let legacy = 0;
if (legacyDir) {
  const have = new Set<string>();
  for (const split of ["train", "val"]) for (const f of fs.readdirSync(path.join(outDir, "images", split))) have.add(f.replace(/.jpg$/, ""));
  for (const split of ["train", "val"]) {
    for (const f of fs.readdirSync(path.join(legacyDir, "images", split))) {
      const id = f.replace(/.jpg$/, "");
      if (!/^[0-9a-f]{8}-/.test(id) || /_w[0-9]$/.test(id) || have.has(id)) continue;
      const lbl = path.join(legacyDir, "labels", split, id + ".txt");
      if (!fs.existsSync(lbl) || checked.get(id) === "rejected") continue;
      fs.copyFileSync(path.join(legacyDir, "images", split, f), path.join(outDir, "images", "train", f));
      fs.copyFileSync(lbl, path.join(outDir, "labels", "train", id + ".txt"));
      have.add(id); legacy++;
    }
  }
}
fs.writeFileSync(path.join(outDir, "data.yaml"), ["path: .", "train: images/train", "val: images/val", "names:", "  0: dart", "  1: cal_1", "  2: cal_2", "  3: cal_3", "  4: cal_4", ""].join("\n"));
moves.sort((a, b) => a - b);
console.log(`older straightened samples taken from the earlier set: ${legacy}`);
console.log(`pictures: ${pics.size} (${fromBatches} only from batch files)`);
console.log(`written: train ${stats.train} (+${synthetic} synthetic), val ${stats.val}; darts ${stats.darts}; with a double-ring dart: train ${stats.doublesTrain}, val ${stats.doublesVal}`);
console.log(`left out: rejected ${stats.rejected}, chip-corrected & not checked ${stats.snappedSkipped}, no darts ${stats.noDarts}, wire fit failed ${stats.fitFailed}, fit moved too far ${stats.tooFar}`);
console.log(`wire-fit move mm: median ${moves[moves.length >> 1]?.toFixed(2)} p90 ${moves[Math.floor(moves.length * 0.9)]?.toFixed(2)}`);
