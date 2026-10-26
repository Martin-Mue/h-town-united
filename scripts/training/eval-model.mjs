// Measures a dart-tip model on a fixed test set: the samples whose labels were checked by hand (ai-verdicts-*.json) taken
// from a training-dataset export. Run it for the model in the app and for a candidate and compare the numbers; a change
// only goes live when it is clearly better on THIS set (it must never be part of a training run).
//
//   node scripts/training/eval-model.mjs <training-dataset.json> <model.onnx> [--thr=0.3] [--skip=<verdict file name part>]
//
// Prints: share of labelled darts found within 8.5 / 17 / 34 mm, median error, score correct, extra detections (phantoms)
// per image, and the same split by camera zoom.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.split("=")[1] : fallback; };
const [datasetFile, modelFile] = args.filter((a) => !a.startsWith("--"));
if (!datasetFile || !modelFile) { console.error("Usage: node scripts/training/eval-model.mjs <training-dataset.json> <model.onnx> [--thr=0.3]"); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(root, "package.json"));
const sharp = req("sharp"); const ort = req("onnxruntime-web/wasm");
ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = `file:///${root.split(path.sep).join("/")}/node_modules/onnxruntime-web/dist/`;

const SIZE = 800, R = 0.377, MM = 170 / R, THR = Number(opt("thr", 0.3));
const RING = { bullInner: 0.037, bullOuter: 0.094, trebleInner: 0.582, trebleOuter: 0.629, doubleInner: 0.953, doubleOuter: 1.0 };
const SEG = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const fieldAt = (u, v) => { const r = Math.hypot(u, v); if (r <= RING.bullInner) return "D25"; if (r <= RING.bullOuter) return "25"; if (r > RING.doubleOuter) return "0"; let a = (Math.atan2(u, -v) * 180) / Math.PI; if (a < 0) a += 360; const b = SEG[Math.floor(((a + 9) % 360) / 18)]; return (r > RING.doubleInner ? "D" : r > RING.trebleInner && r <= RING.trebleOuter ? "T" : "") + b; };

// the hand-checked labels: later verdict files win over earlier ones for the same sample
const dir = path.join(root, "scripts/training");
const checked = new Map();
for (const f of fs.readdirSync(dir).filter((f) => /^ai-verdicts-.*\.json$/.test(f)).sort()) {
  for (const v of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) { if (v.labels) checked.set(v.id, v.labels.map((l) => [l.x, l.y])); else checked.delete(v.id); }
}
const dataset = JSON.parse(fs.readFileSync(datasetFile, "utf8")).samples.filter((s) => checked.has(s.id));
console.log(`test set: ${dataset.length} hand-checked samples (of ${checked.size} verdicts), model ${path.basename(modelFile)}, threshold ${THR}`);

const session = await ort.InferenceSession.create(fs.readFileSync(modelFile), { executionProviders: ["wasm"] });
const groups = new Map();
const bands = new Map();
const add = (key, e) => { const g = groups.get(key) ?? { images: 0, labels: 0, w85: 0, w17: 0, w34: 0, errs: [], scoreOk: 0, scoreTot: 0, extra: 0 }; groups.set(key, g); g.images++; for (const k of ["labels", "w85", "w17", "w34", "scoreOk", "scoreTot", "extra"]) g[k] += e[k]; g.errs.push(...e.errs); };
for (const s of dataset) {
  const buf = Buffer.from(s.image.split(",")[1], "base64");
  const rgb = await sharp(buf).resize(SIZE, SIZE, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const t = new Float32Array(3 * SIZE * SIZE);
  for (let p = 0; p < SIZE * SIZE; p++) { t[p] = rgb[p * 3] / 255; t[SIZE * SIZE + p] = rgb[p * 3 + 1] / 255; t[2 * SIZE * SIZE + p] = rgb[p * 3 + 2] / 255; }
  const o = (await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", t, [1, 3, SIZE, SIZE]) }))[session.outputNames[0]];
  const n = o.dims[2], d = o.data, dets = [];
  for (let k = 0; k < n; k++) { const sc = d[4 * n + k]; if (sc >= THR) dets.push({ x: d[k] / SIZE, y: d[n + k] / SIZE, score: sc }); }
  dets.sort((a, b) => b.score - a.score); const kept = [];
  for (const q of dets) if (!kept.some((r) => Math.hypot(r.x - q.x, r.y - q.y) < 0.012)) kept.push(q);
  const e = { labels: 0, w85: 0, w17: 0, w34: 0, errs: [], scoreOk: 0, scoreTot: 0, extra: 0 };
  const free = [...kept];
  for (const [lx, ly] of checked.get(s.id)) {
    e.labels++;
    const band = (() => { const r = Math.hypot((lx - 0.5) / R, (ly - 0.5) / R); return r <= 0.58 ? "inner (to treble)" : r <= 0.953 ? "outer single" : r <= 1.0 ? "double ring" : "outside the double"; })();
    const bg = bands.get(band) ?? { n: 0, found: 0 }; bands.set(band, bg); bg.n++;
    let bi = -1, bd = 1e9; free.forEach((q, i) => { const dd = Math.hypot(q.x - lx, q.y - ly); if (dd < bd) { bd = dd; bi = i; } });
    if (bi < 0) continue;
    const mm = bd * MM; if (mm > 40) continue;
    const q = free.splice(bi, 1)[0]; e.errs.push(mm); bg.found++;
    if (mm <= 8.5) e.w85++; if (mm <= 17) e.w17++; if (mm <= 34) e.w34++;
    e.scoreTot++; if (fieldAt((q.x - 0.5) / R, (q.y - 0.5) / R) === fieldAt((lx - 0.5) / R, (ly - 0.5) / R)) e.scoreOk++;
  }
  e.extra = free.length;
  add("all", e); add(`zoom ${s.camera_zoom ?? "?"}`, e);
}
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : "-");
const med = (a) => { const x = [...a].sort((m, n) => m - n); return x.length ? x[x.length >> 1].toFixed(1) : "-"; };
for (const [key, g] of [...groups.entries()].sort((a, b) => (a[0] === "all" ? -1 : b[0] === "all" ? 1 : a[0].localeCompare(b[0])))) {
  console.log(`${key.padEnd(10)} images ${String(g.images).padStart(3)}  labels ${String(g.labels).padStart(3)}  <=8.5mm ${pct(g.w85, g.labels).padStart(4)}  <=17mm ${pct(g.w17, g.labels).padStart(4)}  <=34mm ${pct(g.w34, g.labels).padStart(4)}  median ${med(g.errs).padStart(5)}mm  field right ${pct(g.scoreOk, g.scoreTot).padStart(4)}  phantoms/image ${(g.extra / g.images).toFixed(2)}`);
}

console.log("\nfound (within 40 mm) by where the labelled tip lies:");
for (const key of ["inner (to treble)", "outer single", "double ring", "outside the double"]) { const b = bands.get(key); if (b) console.log(`  ${key.padEnd(20)} ${String(b.found).padStart(3)} / ${String(b.n).padStart(3)}  ${pct(b.found, b.n)}`); }
