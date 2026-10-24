// Re-straightens every picture of a rectified training set with the wire fit and moves the labels with it.
// usage (repo root): npx tsx scripts/training/realign-training-set.mts <in-dir> <out-dir>
// Pictures whose wire fit is weak or implausibly far (e.g. the synthetic edge-dart pictures) are copied unchanged.
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
import { prepareWireFit, refineTapsToWires } from "../../src/utils/boardWireFit.ts";
import { rectifyMappingFromTaps, warpToRectified, canonicalToRect } from "../../src/utils/boardRectify.ts";
import { CANON_BOARD_POINTS } from "../../src/utils/cameraGeometry.ts";
import { applyHomography } from "../../src/utils/homography.ts";
const req = createRequire(import.meta.url);
const sharp = req("sharp");
const [inName, outName] = process.argv.slice(2);
const IN = path.resolve(inName), OUT = path.resolve(outName);
const MM = 170 / (0.377 * 800);
const ideal = CANON_BOARD_POINTS.map((p: any) => canonicalToRect(p.x, p.y));
const MAX_MOVE_MM = 15;
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(IN, "data.yaml"), path.join(OUT, "data.yaml"));

type Fit = { mapping: ReturnType<typeof rectifyMappingFromTaps>; moveMm: number } | null;
const fitCache = new Map<string, Fit>();
const stats = { fitted: 0, kept: 0, tooFar: 0, moves: [] as number[] };
const calSpreadBefore: number[] = [], calSpreadAfter: number[] = [];

for (const split of ["train", "val"]) {
  fs.mkdirSync(path.join(OUT, "images", split), { recursive: true });
  fs.mkdirSync(path.join(OUT, "labels", split), { recursive: true });
  for (const file of fs.readdirSync(path.join(IN, "images", split))) {
    const stem = file.replace(/\.jpg$/, "");
    const base = stem.replace(/_w\d+$/, ""); // weighted copies share the fit of their original
    const { data, info } = await sharp(path.join(IN, "images", split, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
    const key = split + "/" + base;
    if (!fitCache.has(key)) {
      const fit = refineTapsToWires(prepareWireFit({ data: rgba, width: W, height: H }), ideal);
      let result: Fit = null;
      if (fit && fit.quality >= 0.45) {
        const moveMm = Math.max(...fit.taps.map((p: any, i: number) => Math.hypot(p.x - ideal[i].x, p.y - ideal[i].y) * W * MM));
        if (moveMm <= MAX_MOVE_MM) result = { mapping: rectifyMappingFromTaps(fit.taps), moveMm };
        else stats.tooFar++;
      }
      fitCache.set(key, result);
    }
    const fit = fitCache.get(key)!;
    const labelPath = path.join(IN, "labels", split, stem + ".txt");
    const lines = fs.existsSync(labelPath) ? fs.readFileSync(labelPath, "utf8").split("\n").filter(Boolean) : [];
    if (!fit || !fit.mapping) {
      stats.kept++;
      fs.copyFileSync(path.join(IN, "images", split, file), path.join(OUT, "images", split, file));
      fs.writeFileSync(path.join(OUT, "labels", split, stem + ".txt"), lines.join("\n") + (lines.length ? "\n" : ""));
      continue;
    }
    stats.fitted++; stats.moves.push(fit.moveMm);
    const out = warpToRectified({ data: rgba, width: W, height: H }, fit.mapping.rectToVideo, W);
    const rgb = Buffer.alloc(W * H * 3);
    for (let i = 0; i < W * H; i++) { rgb[i * 3] = out.data[i * 4]; rgb[i * 3 + 1] = out.data[i * 4 + 1]; rgb[i * 3 + 2] = out.data[i * 4 + 2]; }
    await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 88 }).toFile(path.join(OUT, "images", split, file));
    const newLines = lines.map((l) => {
      const [c, x, y, w, h] = l.split(" ");
      const p = applyHomography(fit.mapping!.videoToRect, { x: +x, y: +y });
      return `${c} ${p.x.toFixed(6)} ${p.y.toFixed(6)} ${w} ${h}`;
    });
    fs.writeFileSync(path.join(OUT, "labels", split, stem + ".txt"), newLines.join("\n") + "\n");
    // alignment check on the four corner labels: distance to their canonical wire-crossing positions is measured later
  }
}
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
console.log(`realigned ${stats.fitted} | kept unchanged ${stats.kept} (of which implausible move ${stats.tooFar})`);
console.log(`largest tap move mm: median ${pct(stats.moves, 0.5).toFixed(2)} p90 ${pct(stats.moves, 0.9).toFixed(2)} max ${Math.max(...stats.moves).toFixed(2)}`);
