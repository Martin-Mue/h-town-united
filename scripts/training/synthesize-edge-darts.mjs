// Makes training pictures of darts in the double ring, the treble ring and at the board's edge without anyone having to
// throw them: real darts are cut out of the player's own pictures and pasted onto pictures of the EMPTY board.
//
//   node scripts/training/synthesize-edge-darts.mjs <dataset-dir> <count> --pairs=<dir> [--pairs=<dir> ...] [--seed=1]
//
// <dataset-dir>  a YOLO dataset as built by add-reviewed-batch.mjs (images/train, labels/train, ...). It supplies the
//                labelled "after" pictures the dart cut-outs come from. New pictures are written to its train split only.
// --pairs=<dir>  folders in which to look for the matching "before" picture (the empty board) of a sample: unpacked batches
//                (<sample>/meta.json + before.jpg, see unpack-training-batch.mjs) and images_before/<split>/<id>.jpg folders.
//
// How a cut-out is made: the picture before and after the throw differ almost only where the dart is. The pixels that
// changed form the dart (barrel, flight, shadow); the label says where its tip is. Only darts that stand alone are used
// (no other label inside the same blob, no hand), so every cut-out is one clean dart.
// How a picture is made: 1-3 cut-outs are pasted onto an empty board so that their TIPS land exactly on the chosen ring
// (60 % double ring, 20 % treble ring, 20 % outer edge); the tip positions become the labels, the board's four corner
// classes are written at their ideal positions. Backgrounds that already show a dart (model check) are skipped.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => args.filter((a) => a.startsWith(name + "=")).map((a) => a.split("=")[1]);
const [datasetDir, countArg] = args.filter((a) => !a.startsWith("--"));
if (!datasetDir || !countArg) { console.error("Usage: node scripts/training/synthesize-edge-darts.mjs <dataset-dir> <count> --pairs=<dir> [--pairs=<dir> ...] [--seed=1]"); process.exit(1); }
const COUNT = Number(countArg), PAIR_DIRS = flag("--pairs");
let seed = Number(flag("--seed")[0] ?? 1);
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));
const sharp = require("sharp");

const SIZE = 800, RADIUS = 0.377, DART_BOX = 0.04, CORNER_BOX = 0.05;
const deg = (a) => (a * Math.PI) / 180;

const loadRgb = async (file) => sharp(file).resize(SIZE, SIZE, { fit: "fill" }).removeAlpha().raw().toBuffer();

// ---- find "before" pictures ----
const beforeById = new Map();
const scan = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const meta = path.join(p, "meta.json");
      if (fs.existsSync(meta) && fs.existsSync(path.join(p, "before.jpg"))) beforeById.set(JSON.parse(fs.readFileSync(meta, "utf8")).id, path.join(p, "before.jpg"));
      else scan(p);
    } else if (/\.jpg$/.test(entry.name) && path.basename(dir) !== "after" && /images_before/.test(dir)) beforeById.set(entry.name.replace(/\.jpg$/, ""), p);
  }
};
PAIR_DIRS.forEach(scan);
console.log("before pictures found:", beforeById.size);

// ---- cut darts out ----
const cutouts = [];
const imageDir = path.join(datasetDir, "images", "train"), labelDir = path.join(datasetDir, "labels", "train");
const ids = fs.readdirSync(imageDir).filter((f) => /\.jpg$/.test(f) && !/_(w\d|syn\d*)\.jpg$/.test(f)).map((f) => f.replace(/\.jpg$/, "")).filter((id) => beforeById.has(id));
console.log("training pictures with a before picture:", ids.length);
const MASK_DELTA = 32;
for (const id of ids) {
  const labels = fs.readFileSync(path.join(labelDir, id + ".txt"), "utf8").trim().split("\n").map((l) => l.split(" ").map(Number)).filter((l) => l[0] === 0).map((l) => [l[1] * SIZE, l[2] * SIZE]);
  if (!labels.length) continue;
  const [after, before] = await Promise.all([loadRgb(path.join(imageDir, id + ".jpg")), loadRgb(beforeById.get(id))]);
  const mask = new Uint8Array(SIZE * SIZE);
  let changed = 0;
  for (let p = 0; p < SIZE * SIZE; p++) {
    const d = Math.max(Math.abs(after[p * 3] - before[p * 3]), Math.abs(after[p * 3 + 1] - before[p * 3 + 1]), Math.abs(after[p * 3 + 2] - before[p * 3 + 2]));
    if (d > MASK_DELTA) { mask[p] = 1; changed++; }
  }
  if (changed > SIZE * SIZE * 0.12) continue; // lighting jump or a hand — not usable
  // close the gaps between barrel, shaft and flight (dart pixels are patchy) with two dilation passes
  let dil = mask;
  for (let pass = 0; pass < 3; pass++) {
    const next = new Uint8Array(SIZE * SIZE);
    for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) { const p = y * SIZE + x; if (dil[p] || dil[p - 1] || dil[p + 1] || dil[p - SIZE] || dil[p + SIZE]) next[p] = 1; }
    dil = next;
  }
  const comp = new Int32Array(SIZE * SIZE).fill(-1); const blobs = [];
  for (let s = 0; s < SIZE * SIZE; s++) {
    if (!dil[s] || comp[s] >= 0) continue;
    const id2 = blobs.length; const stack = [s]; comp[s] = id2; let minX = SIZE, minY = SIZE, maxX = 0, maxY = 0, area = 0;
    while (stack.length) { const p = stack.pop(); const x = p % SIZE, y = (p / SIZE) | 0; area++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const q of [p - 1, p + 1, p - SIZE, p + SIZE]) if (q >= 0 && q < SIZE * SIZE && dil[q] && comp[q] < 0) { comp[q] = id2; stack.push(q); } }
    blobs.push({ minX, minY, maxX, maxY, area });
  }
  for (const [tx, ty] of labels) {
    // the blob under (or right next to) the tip
    let blobId = -1;
    for (let r = 0; r <= 14 && blobId < 0; r += 2) for (let dy = -r; dy <= r && blobId < 0; dy += 2) for (let dx = -r; dx <= r; dx += 2) { const x = Math.round(tx + dx), y = Math.round(ty + dy); if (x >= 0 && y >= 0 && x < SIZE && y < SIZE && comp[y * SIZE + x] >= 0) { blobId = comp[y * SIZE + x]; break; } }
    if (blobId < 0) continue;
    const b = blobs[blobId]; const w = b.maxX - b.minX + 1, h = b.maxY - b.minY + 1;
    let real = 0; for (let y = b.minY; y <= b.maxY; y++) for (let x = b.minX; x <= b.maxX; x++) if (comp[y * SIZE + x] === blobId && mask[y * SIZE + x]) real++;
    // thin arcs left by a slightly shifted board (wires) have a large box but few really changed pixels; a dart is solid
    if (real < 1800 || real / (w * h) < 0.10 || Math.hypot(w, h) > 330) continue;
    if (Math.hypot(w, h) < 120 || w > 420 || h > 420 || b.area < 2200 || b.area > 30000) continue; // a whole dart is ~160 px long
    const others = labels.filter(([ox, oy]) => (ox !== tx || oy !== ty) && ox >= b.minX - 6 && ox <= b.maxX + 6 && oy >= b.minY - 6 && oy <= b.maxY + 6);
    if (others.length) continue; // two darts in one blob
    const pad = 3, x0 = Math.max(0, b.minX - pad), y0 = Math.max(0, b.minY - pad), cw = Math.min(SIZE, b.maxX + pad + 1) - x0, ch = Math.min(SIZE, b.maxY + pad + 1) - y0;
    const rgba = Buffer.alloc(cw * ch * 4);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const p = (y0 + y) * SIZE + x0 + x; const o = (y * cw + x) * 4;
      rgba[o] = after[p * 3]; rgba[o + 1] = after[p * 3 + 1]; rgba[o + 2] = after[p * 3 + 2];
      rgba[o + 3] = comp[p] === blobId && (mask[p] || mask[p - 1] || mask[p + 1] || mask[p - SIZE] || mask[p + SIZE]) ? 255 : 0; // only the changed pixels (and their rim)
    }
    cutouts.push({ rgba, cw, ch, tipX: tx - x0, tipY: ty - y0, id });
  }
}
console.log("dart cut-outs:", cutouts.length);
if (cutouts.length < 8) { console.error("too few cut-outs to synthesize from"); process.exit(1); }

// ---- empty-board backgrounds without any dart (checked by the app's own model) ----
const ort = require("onnxruntime-web/wasm");
ort.env.wasm.numThreads = 1; ort.env.wasm.wasmPaths = pathToFileUrl(path.join(root, "node_modules", "onnxruntime-web", "dist")) + "/";
function pathToFileUrl(p) { return "file:///" + p.replace(/\\/g, "/").replace(/ /g, "%20"); }
const session = await ort.InferenceSession.create(fs.readFileSync(path.join(root, "public", "models", "best.onnx")), { executionProviders: ["wasm"] });
const hasDart = async (rgb) => {
  const t = new Float32Array(3 * SIZE * SIZE); for (let p = 0; p < SIZE * SIZE; p++) { t[p] = rgb[p * 3] / 255; t[SIZE * SIZE + p] = rgb[p * 3 + 1] / 255; t[2 * SIZE * SIZE + p] = rgb[p * 3 + 2] / 255; }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", t, [1, 3, SIZE, SIZE]) }); const o = out[session.outputNames[0]]; const n = o.dims[2];
  for (let k = 0; k < n; k++) if (o.data[4 * n + k] >= 0.15) return true; return false;
};
const backgrounds = [];
// Where the board sits in a background: from the corner labels of the sample it belongs to (cal_1 and cal_2 lie 9 degrees
// beside the top / bottom of the outer double edge, so their midpoint is the board's centre).
const geometryOf = (id) => {
  const file = path.join(labelDir, id + ".txt"); if (!fs.existsSync(file)) return null;
  const c = {}; for (const line of fs.readFileSync(file, "utf8").trim().split(String.fromCharCode(10))) { const [k, x, y] = line.split(" ").map(Number); if (k >= 1 && k <= 4) c[k] = [x, y]; }
  if (!c[1] || !c[2]) return null;
  const cx = (c[1][0] + c[2][0]) / 2, cy = (c[1][1] + c[2][1]) / 2, R = Math.hypot(c[1][0] - c[2][0], c[1][1] - c[2][1]) / 2;
  return { cx, cy, R, corners: [1, 2, 3, 4].map((k) => c[k]) };
};
const candidateIds = ids.slice();
for (let i = candidateIds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [candidateIds[i], candidateIds[j]] = [candidateIds[j], candidateIds[i]]; }
for (const id of candidateIds) {
  if (backgrounds.length >= 40) break;
  const geometry = geometryOf(id);
  if (!geometry || Math.abs(geometry.R - RADIUS) > 0.012 || Math.abs(geometry.cx - 0.5) > 0.03 || Math.abs(geometry.cy - 0.5) > 0.03) continue; // board not where the frame says it is
  const rgb = await loadRgb(beforeById.get(id));
  if (!(await hasDart(rgb))) backgrounds.push({ rgb, geometry });
}
console.log("empty-board backgrounds:", backgrounds.length);
if (!backgrounds.length) { console.error("no empty background found"); process.exit(1); }

// ---- compose ----
const ringRadius = () => { const k = rnd(); return k < 0.6 ? 0.955 + rnd() * 0.04 : k < 0.8 ? 0.6 + rnd() * 0.025 : 0.9 + rnd() * 0.045; };
const kinds = { double: 0, treble: 0, edge: 0 };
let made = 0;
for (let n = 0; made < COUNT && n < COUNT * 5; n++) {
  const chosen = backgrounds[Math.floor(rnd() * backgrounds.length)]; const bg = Buffer.from(chosen.rgb); const board = chosen.geometry;
  const tips = []; const count = 1 + Math.floor(rnd() * 3);
  for (let attempt = 0; tips.length < count && attempt < 20; attempt++) {
    const r = ringRadius(), a = rnd() * 2 * Math.PI;
    const tx = SIZE * (board.cx + board.R * r * Math.sin(a)), ty = SIZE * (board.cy - board.R * r * Math.cos(a));
    if (tips.some((t) => Math.hypot(t.x - tx, t.y - ty) < 70)) continue;
    const cut = cutouts[Math.floor(rnd() * cutouts.length)];
    const gain = 0.92 + rnd() * 0.16;
    // rotate (+-18 degrees) and scale (0.9-1.12) around the TIP, which stays exactly where it was put
    const ang = (rnd() - 0.5) * deg(36), scl = 0.9 + rnd() * 0.22, cs = Math.cos(ang), sn = Math.sin(ang);
    const reach = Math.ceil(Math.hypot(cut.cw, cut.ch) * 1.3);
    for (let dy = -reach; dy <= reach; dy++) { const py = Math.round(ty) + dy; if (py < 0 || py >= SIZE) continue;
      for (let dx = -reach; dx <= reach; dx++) { const px = Math.round(tx) + dx; if (px < 0 || px >= SIZE) continue;
        // inverse mapping into the cut-out (relative to its tip)
        const sx = (cs * dx + sn * dy) / scl + cut.tipX, sy = (-sn * dx + cs * dy) / scl + cut.tipY;
        const ix = Math.round(sx), iy = Math.round(sy); if (ix < 0 || iy < 0 || ix >= cut.cw || iy >= cut.ch) continue;
        const o = (iy * cut.cw + ix) * 4; if (!cut.rgba[o + 3]) continue; const p = (py * SIZE + px) * 3;
        bg[p] = Math.min(255, cut.rgba[o] * gain); bg[p + 1] = Math.min(255, cut.rgba[o + 1] * gain); bg[p + 2] = Math.min(255, cut.rgba[o + 2] * gain); } }
    tips.push({ x: tx, y: ty, r });
    kinds[r > 0.95 ? "double" : r < 0.64 ? "treble" : "edge"]++;
  }
  if (!tips.length) continue;
  const name = `syn${String(made).padStart(4, "0")}`;
  await sharp(bg, { raw: { width: SIZE, height: SIZE, channels: 3 } }).blur(0.6).jpeg({ quality: 92 }).toFile(path.join(imageDir, name + ".jpg"));
  const lines = tips.map((t) => `0 ${(t.x / SIZE).toFixed(6)} ${(t.y / SIZE).toFixed(6)} ${DART_BOX} ${DART_BOX}`);
  board.corners.forEach(([x, y], i) => lines.push(`${i + 1} ${x.toFixed(6)} ${y.toFixed(6)} ${CORNER_BOX} ${CORNER_BOX}`));
  fs.writeFileSync(path.join(labelDir, name + ".txt"), lines.join("\n") + "\n");
  made++;
}
console.log(`wrote ${made} synthetic pictures (darts: ${kinds.double} double ring, ${kinds.treble} treble ring, ${kinds.edge} outer edge)`);
