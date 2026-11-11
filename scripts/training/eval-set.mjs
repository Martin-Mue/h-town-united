// Measures a dart-tip model on the VALIDATION images of a training set built by build-training-set.mts (images/val + labels/val),
// i.e. with the labels the next training run is measured against. Run it for the model in the app and for a candidate:
//
//   node scripts/training/eval-set.mjs <training-set-dir> <model.onnx> [--thr=0.3] [--split=val] [--app]
//
// --app mimics what the app does with the raw detections (src/utils/dartModel.ts): box NMS with IoU 0.5 and at most as many
// darts as are on the board (the app asks for the number of darts still expected). Without it the numbers are the raw ones the
// Colab notebook prints (distance dedupe only, no cap), where every weak extra box counts as a phantom.
//
// Prints: darts found within 8.5 / 17 / 34 mm, median error, right scoring field, phantoms per image, and the same for the
// darts that have another dart closer than 25 mm (tight groups) and for the double ring. The numbers use the SAME matching as the
// notebook (nearest unmatched detection per label, no distance limit for "found" beyond 40 mm).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.split("=")[1] : fallback; };
const [setDir, modelFile] = args.filter((a) => !a.startsWith("--"));
if (!setDir || !modelFile) { console.error("Usage: node scripts/training/eval-set.mjs <training-set-dir> <model.onnx> [--thr=0.3] [--split=val]"); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(root, "package.json"));
const sharp = req("sharp"); const ort = req("onnxruntime-web/wasm");
ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = `file:///${root.split(path.sep).join("/")}/node_modules/onnxruntime-web/dist/`;

const APP = args.includes("--app");
const SIZE = 800, R = 0.377, MM = 170 / R, THR = Number(opt("thr", "0.3")), SPLIT = opt("split", "val");
const SEG = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const fieldAt = (x, y) => { const u = (x - 0.5) / R, v = (y - 0.5) / R, r = Math.hypot(u, v); if (r <= 0.037) return "D25"; if (r <= 0.094) return "25"; if (r > 1) return "0"; let a = (Math.atan2(u, -v) * 180) / Math.PI; if (a < 0) a += 360; const b = SEG[Math.floor(((a + 9) % 360) / 18)]; return (r > 0.953 ? "D" : r > 0.582 && r <= 0.629 ? "T" : "") + b; };

const session = await ort.InferenceSession.create(fs.readFileSync(modelFile), { executionProviders: ["wasm"] });
const imgDir = path.join(setDir, "images", SPLIT), lblDir = path.join(setDir, "labels", SPLIT);
const mk = () => ({ n: 0, w85: 0, w17: 0, w34: 0, errs: [], scoreOk: 0, scoreTot: 0 });
const groups = { all: mk(), tight: mk(), double: mk() };
let images = 0, extra = 0;
for (const f of fs.readdirSync(imgDir).filter((f) => f.endsWith(".jpg") && !/_w\d/.test(f)).sort()) {
  const gt = fs.readFileSync(path.join(lblDir, f.replace(/\.jpg$/, ".txt")), "utf8").trim().split("\n").map((l) => l.split(" ").map(Number)).filter((l) => l[0] === 0).map((l) => [l[1], l[2]]);
  const rgb = await sharp(path.join(imgDir, f)).resize(SIZE, SIZE, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const t = new Float32Array(3 * SIZE * SIZE);
  for (let p = 0; p < SIZE * SIZE; p++) { t[p] = rgb[p * 3] / 255; t[SIZE * SIZE + p] = rgb[p * 3 + 1] / 255; t[2 * SIZE * SIZE + p] = rgb[p * 3 + 2] / 255; }
  const o = (await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", t, [1, 3, SIZE, SIZE]) }))[session.outputNames[0]];
  const n = o.dims[2], d = o.data, dets = [];
  for (let k = 0; k < n; k++) { const sc = d[4 * n + k]; if (sc >= THR) dets.push({ x: d[k] / SIZE, y: d[n + k] / SIZE, w: d[2 * n + k] / SIZE, h: d[3 * n + k] / SIZE, score: sc }); }
  dets.sort((a, b) => b.score - a.score);
  const boxIou = (a, b) => { const iw = Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)), ih = Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2)), inter = iw * ih; return inter / (a.w * a.h + b.w * b.h - inter || 1); };
  const kept = [];
  for (const q of dets) {
    if (APP && kept.length >= Math.max(1, gt.length)) break; // the app caps at the number of darts expected
    if (APP ? kept.some((r) => boxIou(r, q) > 0.5) : kept.some((r) => Math.hypot(r.x - q.x, r.y - q.y) < 0.012)) continue;
    kept.push(q);
  }
  const free = [...kept];
  images++;
  for (const [lx, ly] of gt) {
    const tight = gt.some(([ox, oy]) => (ox !== lx || oy !== ly) && Math.hypot(ox - lx, oy - ly) * MM < 25);
    const dbl = Math.hypot((lx - 0.5) / R, (ly - 0.5) / R) > 0.953;
    const targets = [groups.all, ...(tight ? [groups.tight] : []), ...(dbl ? [groups.double] : [])];
    targets.forEach((g) => g.n++);
    let bi = -1, bd = 1e9; free.forEach((q, i) => { const dd = Math.hypot(q.x - lx, q.y - ly); if (dd < bd) { bd = dd; bi = i; } });
    if (bi < 0 || bd * MM > 40) continue;
    const q = free.splice(bi, 1)[0], mm = bd * MM;
    targets.forEach((g) => { g.errs.push(mm); if (mm <= 8.5) g.w85++; if (mm <= 17) g.w17++; if (mm <= 34) g.w34++; g.scoreTot++; if (fieldAt(q.x, q.y) === fieldAt(lx, ly)) g.scoreOk++; });
  }
  extra += free.length;
}
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : "-");
const med = (a) => { const x = [...a].sort((m, n) => m - n); return x.length ? x[x.length >> 1].toFixed(1) : "-"; };
console.log(`${APP ? "[app logic] " : ""}${path.basename(modelFile)} on ${SPLIT} of ${path.basename(path.resolve(setDir))}: ${images} images, threshold ${THR}, phantoms/image ${(extra / images).toFixed(2)}`);
for (const [k, g] of Object.entries(groups)) console.log(`${k.padEnd(7)} labels ${String(g.n).padStart(4)}  found ${pct(g.errs.length, g.n).padStart(4)}  <=8.5mm ${pct(g.w85, g.n).padStart(4)}  <=17mm ${pct(g.w17, g.n).padStart(4)}  <=34mm ${pct(g.w34, g.n).padStart(4)}  median ${med(g.errs).padStart(5)}mm  field right ${pct(g.scoreOk, g.n).padStart(4)}`);
