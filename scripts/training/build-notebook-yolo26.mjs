// Generates train-yolo26.ipynb: the experiment "a newer / bigger model instead of fine-tuning the old one".
// It reuses the setup and measuring cells of finetune-dart-model.ipynb (run build-notebook.mjs first), so both notebooks
// measure the same way, and adds: training YOLO26 n / s from the COCO weights on the dataset, export to ONNX the way the
// app needs it, speed measurement on one CPU thread (the app runs the model in the browser on the phone), and a decision.
import fs from "node:fs";

const base = JSON.parse(fs.readFileSync(new URL("./finetune-dart-model.ipynb", import.meta.url), "utf8"));
const toSource = (text) => text.split("\n").map((line, i, all) => (i < all.length - 1 ? line + "\n" : line));
const md = (text) => ({ cell_type: "markdown", metadata: {}, source: toSource(text) });
const code = (text) => ({ cell_type: "code", metadata: {}, execution_count: null, outputs: [], source: toSource(text) });

// cells of the first notebook: 1 = install + Drive + upload, 3 = metrics (4 = its markdown header is cell 2)
const setupCell = JSON.parse(JSON.stringify(base.cells[1]));
setupCell.source = setupCell.source.map((line) => line.replace("training-set-rectified-v6.zip", "training-set-rectified-v7.zip"));
const metricsMarkdown = base.cells[2];
const metricsCell = base.cells[3];

const cells = [
  md(String.raw`# DartSpot: YOLO26 statt Nachtraining

Die Läufe v5 und v6 haben das laufende Modell (v4, YOLOv8n) nicht verbessert. Dieses Notebook probiert das, was bisher fehlt: **ein neueres Modell von Grund auf trainieren** (YOLO26, vortrainiert auf COCO) und prüfen, ob es die schwachen Fälle (Double-Ring, Rand) besser trifft. Zwei Größen laufen nacheinander: **yolo26n** (so klein wie v4, aber neuer) und **yolo26s** (3-4x so rechenintensiv).

Vorher in Colab: **Laufzeit → Laufzeittyp ändern → GPU (T4)**, danach **Alle ausführen** und die Zip \`training-set-rectified-v7.zip\` hochladen. Ein Durchlauf dauert etwa 30-60 Minuten.

Was am Ende zählt, wie bisher: Abstand zur echten Spitze in Millimetern, getrennt nach Double, Treble/Rand, links unten. Neu: **Rechenzeit auf einem CPU-Kern** (die App rechnet im Browser auf dem Handy) und die **Form der ONNX-Ausgabe** (die App versteht das klassische Format \`[1, 9, N]\` und das neue NMS-freie \`[1, K, 6]\`).`),
  setupCell,
  metricsMarkdown,
  metricsCell,

  md(String.raw`## Vorher-Messung: das laufende Modell (ALT) – Genauigkeit und Rechenzeit`),
  code(String.raw`import time, numpy as np, onnxruntime as ort, os

def time_onnx(path, runs=7):
    """Median-Rechenzeit einer Auswertung auf EINEM CPU-Kern (grobe Vergleichszahl, kein Handy-Wert)."""
    so = ort.SessionOptions(); so.intra_op_num_threads = 1
    sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
    name = sess.get_inputs()[0].name
    x = np.random.rand(1, 3, 800, 800).astype(np.float32)
    sess.run(None, {name: x})  # warm-up
    times = []
    for _ in range(runs):
        t0 = time.perf_counter(); sess.run(None, {name: x}); times.append((time.perf_counter() - t0) * 1000)
    out_shape = [o.shape for o in sess.get_outputs()]
    return float(np.median(times)), out_shape, os.path.getsize(path) / 1e6

old = YOLO("/content/best.pt")
KINDS = ["double", "treble/rand", "links unten"]
old_tip = tip_metrics(old)
old_dense = tip_metrics(old, dense_only=True)
old_hard = {k: tip_metrics(old, kind=k) for k in KINDS}
old_ap = ap50_by_class(old.val(data=f"{DS}/data.yaml", imgsz=800, plots=False))
old_onnx = old.export(format="onnx", imgsz=800, opset=12, simplify=True, dynamic=False)
old_ms, old_shape, old_mb = time_onnx(old_onnx)
show("ALT", old_tip); show("ALT dicht", old_dense)
for k in KINDS: show("ALT " + k, old_hard[k])
print(f"ALT Rechenzeit {old_ms:.0f} ms (1 CPU-Kern), {old_mb:.1f} MB, Ausgabe {old_shape}")`),

  md(String.raw`## Training: YOLO26 n und s
Kein Spiegeln/Drehen (die 20 ist im entzerrten Bild immer oben, die Ecken haben feste Plätze), kein Mosaic (es würde das Board zerstückeln und die Ecken-Klassen zerstören). Geringe Farb- und Verschiebungs-Augmentierung wie bisher. Frühes Stoppen nach 40 Epochen ohne Besserung.`),
  code(String.raw`VARIANTS = {
    "yolo26n": dict(weights="yolo26n.pt", epochs=160, batch=16),
    "yolo26s": dict(weights="yolo26s.pt", epochs=160, batch=16),
}
results = {}
for name, cfg in VARIANTS.items():
    m = YOLO(cfg["weights"])
    m.train(
        data=f"{DS}/data.yaml", imgsz=800, epochs=cfg["epochs"], batch=cfg["batch"], patience=40, optimizer="AdamW", lr0=0.002, lrf=0.05,
        fliplr=0.0, flipud=0.0, degrees=0.0, translate=0.05, scale=0.15, shear=0.0, perspective=0.0,
        mosaic=0.0, mixup=0.0, hsv_h=0.01, hsv_s=0.5, hsv_v=0.35,
        project="/content/runs", name=name, exist_ok=True, plots=False,
    )
    best_path = str(m.trainer.best)
    trained = YOLO(best_path)
    r = {"path": best_path, "tip": tip_metrics(trained), "dense": tip_metrics(trained, dense_only=True),
         "hard": {k: tip_metrics(trained, kind=k) for k in KINDS},
         "ap": ap50_by_class(trained.val(data=f"{DS}/data.yaml", imgsz=800, plots=False))}
    # export the way the app needs it; the classic raw head ([1, 9, N]) first, the NMS-free head as a fallback
    onnx_path, mode = None, None
    for kwargs, label in ((dict(end2end=False), "klassisch [1,9,N]"), (dict(), "NMS-frei (Standard)")):
        try:
            onnx_path = trained.export(format="onnx", imgsz=800, opset=12, simplify=True, dynamic=False, **kwargs); mode = label; break
        except Exception as err:
            print(name, "Export", label, "fehlgeschlagen:", str(err)[:160])
    if onnx_path:
        r["ms"], r["shape"], r["mb"] = time_onnx(onnx_path)
        r["onnx"], r["mode"] = onnx_path, mode
    results[name] = r
    show(name, r["tip"]); show(name + " dicht", r["dense"])
    for k in KINDS: show(name + " " + k, r["hard"][k])
    print(f"{name}: Rechenzeit {r.get('ms', float('nan')):.0f} ms (1 CPU-Kern, ALT {old_ms:.0f} ms), {r.get('mb', 0):.1f} MB, Ausgabe {r.get('shape')} ({r.get('mode')})")`),

  md(String.raw`## Ergebnis und Entscheidung
Ein neues Modell geht nur in die App, wenn es **spürbar besser** ist (mindestens +5 Prozentpunkte innerhalb 17 mm insgesamt **oder** +15 bei den Doubles), die vier Ecken nicht schlechter sind und es **nicht mehr als 2,5x so langsam** ist wie das laufende.`),
  code(String.raw`show("ALT", old_tip)
for k in KINDS: show("ALT " + k, old_hard[k])
verdicts = {}
for name, r in results.items():
    print()
    show(name, r["tip"])
    for k in KINDS: show(name + " " + k, r["hard"][k])
    print(f"   AP50 je Klasse: { {c: round(a, 3) for c, a in r['ap'].items()} }  |  {r.get('ms', float('nan')):.0f} ms vs ALT {old_ms:.0f} ms")
    corners_ok = all(r["ap"].get(c, 0) >= old_ap.get(c, 0) - 0.05 for c in (1, 2, 3, 4))
    better = (r["tip"]["r17"] >= old_tip["r17"] + 0.05) or (r["hard"]["double"]["r17"] >= old_hard["double"]["r17"] + 0.15)
    fast_enough = r.get("ms", 1e9) <= 2.5 * old_ms
    verdicts[name] = better and corners_ok and fast_enough
    print(f"   -> besser: {better} | Ecken ok: {corners_ok} | schnell genug: {fast_enough}  =>  {'JA' if verdicts[name] else 'NEIN'}")

winners = [n for n, ok in verdicts.items() if ok]
print()
if winners:
    WINNER = max(winners, key=lambda n: results[n]["tip"]["r17"])
    print("Gewinner:", WINNER, "- JA, in die App")
else:
    WINNER = max(results, key=lambda n: results[n]["tip"]["r17"])
    print("Kein Modell erfüllt alle Bedingungen - NEIN, altes Modell behalten (bestes Experiment:", WINNER + ")")`),

  md(String.raw`## Export
Die ONNX-Datei des besten Experiments zum Herunterladen (auch bei NEIN, damit ich sie offline gegen das laufende Modell messen kann). Das Original in Drive bleibt unberührt.`),
  code(String.raw`from google.colab import files
win = results[WINNER]
shutil.copy(win["path"], "/content/drive/MyDrive/DeepDarts-Dataset/dartspot_yolo26_best.pt")
print("ONNX:", win.get("onnx"), "| Modus:", win.get("mode"), "| Ausgabeform:", win.get("shape"))
if win.get("onnx"):
    files.download(win["onnx"])
files.download(win["path"])`),
];

const notebook = {
  cells,
  metadata: { kernelspec: { name: "python3", display_name: "Python 3" }, language_info: { name: "python" }, accelerator: "GPU" },
  nbformat: 4,
  nbformat_minor: 5,
};
fs.writeFileSync(new URL("./train-yolo26.ipynb", import.meta.url), JSON.stringify(notebook, null, 1));
console.log("wrote train-yolo26.ipynb");
