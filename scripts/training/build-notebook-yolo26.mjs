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
// The zip is big (157 MB): use a copy in Drive when there is one, upload only otherwise.
{
  const text = setupCell.source.join("");
  const from = text.indexOf('print("Lade training-set-rectified-v7.zip hoch:")');
  const to = text.indexOf('assert zip_names, "Keine .zip hochgeladen"');
  if (from < 0 || to < 0) throw new Error("upload block not found in the setup cell");
  const replacement = [
    'DRIVE_ZIP = DRIVE + "training-set-rectified-v7.zip"',
    'if os.path.exists(DRIVE_ZIP):',
    '    zip_names = [DRIVE_ZIP]   # Kopie liegt schon in Drive: kein Upload noetig',
    '    print("Datenset aus Drive:", DRIVE_ZIP)',
    'else:',
    '    print("Lade training-set-rectified-v7.zip hoch (Tipp: einmal in den Drive-Ordner DeepDarts-Dataset legen, dann entfaellt der Upload):")',
    '    uploaded = files.upload()',
    '    zip_names = [n for n in uploaded if n.lower().endswith(".zip")]',
    '',
  ].join("\n");
  setupCell.source = (text.slice(0, from) + replacement + text.slice(to)).split("\n").map((l, i, all) => (i < all.length - 1 ? l + "\n" : l));
}
const metricsMarkdown = base.cells[2];
const metricsCell = base.cells[3];

const cells = [
  md(String.raw`# DartSpot: YOLO26 mit dem Original-Datensatz

Die Läufe v5 und v6 haben das laufende Modell (v4, YOLOv8n) nicht verbessert, weil v4 auf den ~16 000 Bildern des **DeepDarts-Datensatzes** (McNally et al. 2021) aufbaut und unsere ~1100 Bilder allein dagegen nichts Neues beibringen. Dieses Notebook probiert deshalb das, was bisher fehlt: **ein neueres Modell von Grund auf trainieren** (YOLO26, vortrainiert auf COCO) – und zwar auf **DeepDarts (3500 zufällige Bilder daraus) plus unseren Bildern** – und prüft, ob es die schwachen Fälle (Double-Ring, Rand) besser trifft. Zwei Größen laufen nacheinander: **yolo26n** (so klein wie v4, aber neuer) und **yolo26s** (3-4x so rechenintensiv).

Vorher in Colab: **Laufzeit → Laufzeittyp ändern → GPU (T4)**, danach **Alle ausführen** und die Zip \`training-set-rectified-v7.zip\` hochladen. Ein Durchlauf dauert etwa 30-60 Minuten.

Was am Ende zählt, wie bisher: Abstand zur echten Spitze in Millimetern, getrennt nach Double, Treble/Rand, links unten. Neu: **Rechenzeit auf einem CPU-Kern** (die App rechnet im Browser auf dem Handy) und die **Form der ONNX-Ausgabe** (die App versteht das klassische Format \`[1, 9, N]\` und das neue NMS-freie \`[1, K, 6]\`).`),
  setupCell,
  metricsMarkdown,
  metricsCell,

  md(String.raw`## Vorher-Messung: das laufende Modell (ALT) – Genauigkeit und Rechenzeit`),
  code(String.raw`!pip -q install onnxruntime onnx onnxslim
import time, numpy as np, onnxruntime as ort, os

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

  md(String.raw`## Original-Datensatz einmischen (DeepDarts)
Die Bilder liegen in deinem Drive-Ordner (cropped_images.zip + labels_pkl.zip, ~16 000 Bilder, 800 px). Das Notebook zieht 3500 zufällige Bilder heraus und schreibt die Labels im selben Format wie unsere (Klasse 0 = Dart, 1-4 = die vier Ecken). **Sicherheitsnetz:** welcher der vier Eck-Punkte im Original zu welcher Klasse gehört, prüft das Notebook selbst, indem es die Zuordnung wählt, bei der das laufende Modell (v4) auf den Bildern am besten übereinstimmt. Bewertet wird weiterhin NUR auf unseren 72 echten Bewertungsbildern.`),
  code(String.raw`import itertools, random, pandas as pd

DD_SAMPLE = 3500
BOX_DART, BOX_CORNER = 0.04, 0.05
dd_zips = sorted(glob.glob(DRIVE + "cropped_images*.zip"))
dd_pkls = sorted(glob.glob(DRIVE + "labels_pkl*.zip")) + sorted(glob.glob(DRIVE + "labels.pkl"))
MIX = DS
if not dd_zips or not dd_pkls:
    print("ACHTUNG: DeepDarts-Dateien (cropped_images.zip / labels_pkl.zip) nicht in", DRIVE, "- es wird nur mit unseren Bildern trainiert.")
else:
    t0 = time.time()
    pkl_path = dd_pkls[0]
    if pkl_path.endswith(".zip"):
        zipfile.ZipFile(pkl_path).extractall("/content/ddlabels"); pkl_path = "/content/ddlabels/labels.pkl"
    df = pd.read_pickle(pkl_path)
    print("Spalten:", list(df.columns), "| Zeilen:", len(df))
    shutil.copy(dd_zips[0], "/content/cropped_images.zip")   # schneller Zugriff als direkt vom Drive
    zf = zipfile.ZipFile("/content/cropped_images.zip")
    members = {n.split("/", 2)[-1] if n.startswith("cropped_images/800/") else n: n for n in zf.namelist() if n.lower().endswith(".jpg")}
    def find_member(folder, name):
        for key in (f"{folder}/{name}", f"{folder}/{name}".replace("\\", "/")):
            if key in members: return members[key]
        return None
    rows = df.sample(n=min(DD_SAMPLE, len(df)), random_state=0)
    items = []
    for _, row in rows.iterrows():
        member = find_member(str(row["img_folder"]), str(row["img_name"]))
        try:
            arr = np.array([np.asarray(p, dtype=float).ravel()[:2] for p in row["xy"]])
        except Exception:
            continue
        pts = arr if arr.ndim == 2 and arr.shape[1] == 2 else np.zeros((0, 2))
        if member is None or len(pts) < 4 or not np.isfinite(pts[:4]).all():
            continue
        items.append((member, pts))
    print("Bilder mit Labels gefunden:", len(items), "von", len(rows))

    # 1. Zuordnung der vier Eck-Punkte zu den Klassen cal_1..cal_4 vom laufenden Modell lernen lassen
    probe = items[:40]
    for member, _ in probe:
        zf.extract(member, "/content/ddprobe")
    cost = np.zeros((4, 4))   # cost[i, j]: Abstand des Original-Punkts i zur Vorhersage der Klasse j+1
    for member, pts in probe:
        res = old.predict(f"/content/ddprobe/{member}", imgsz=800, conf=0.3, verbose=False)[0]
        best = {}
        for b in res.boxes:
            c = int(b.cls)
            if 1 <= c <= 4 and (c not in best or float(b.conf) > best[c][0]):
                best[c] = (float(b.conf), float(b.xywhn[0][0]), float(b.xywhn[0][1]))
        for i in range(4):
            for j in range(4):
                if (j + 1) in best:
                    cost[i, j] += math.hypot(pts[i][0] - best[j + 1][1], pts[i][1] - best[j + 1][2])
                else:
                    cost[i, j] += 0.5
    perm = min(itertools.permutations(range(4)), key=lambda p: sum(cost[i, p[i]] for i in range(4)))
    mean_err = sum(cost[i, perm[i]] for i in range(4)) / (4 * len(probe))
    print("Zuordnung Original-Punkt -> Klasse:", {i: perm[i] + 1 for i in range(4)}, f"| mittlere Abweichung {mean_err:.3f} (Bildbreite)")
    assert mean_err < 0.08, f"Eck-Zuordnung passt nicht zum laufenden Modell (Abweichung {mean_err:.3f}); Beispielzeile: {df.iloc[0].to_dict()} - bitte an Claude schicken"

    # 2. Bilder und Labels schreiben
    os.makedirs("/content/dd/images/train", exist_ok=True); os.makedirs("/content/dd/labels/train", exist_ok=True)
    written = 0
    for k, (member, pts) in enumerate(items):
        zf.extract(member, "/content/ddraw")
        name = f"dd{k:05d}"
        shutil.move(f"/content/ddraw/{member}", f"/content/dd/images/train/{name}.jpg")
        lines = [f"{perm[i] + 1} {pts[i][0]:.6f} {pts[i][1]:.6f} {BOX_CORNER} {BOX_CORNER}" for i in range(4)]
        for x, y in pts[4:]:
            if 0 < x < 1 and 0 < y < 1:
                lines.append(f"0 {x:.6f} {y:.6f} {BOX_DART} {BOX_DART}")
        open(f"/content/dd/labels/train/{name}.txt", "w").write("
".join(lines) + "
")
        written += 1
    shutil.rmtree("/content/ddraw", ignore_errors=True); shutil.rmtree("/content/ddprobe", ignore_errors=True)
    os.makedirs("/content/mix", exist_ok=True)
    MIX = "/content/mix"
    with open(f"{MIX}/data.yaml", "w") as f:
        f.write("
".join([f"path: /content", f"train: [{DS}/images/train, /content/dd/images/train]", f"val: {DS}/images/val", "names:",
                           "  0: dart", "  1: cal_1", "  2: cal_2", "  3: cal_3", "  4: cal_4", ""]))
    print(f"DeepDarts-Bilder eingemischt: {written} | Trainingsbilder insgesamt: {len(glob.glob(DS + '/images/train/*.jpg')) + written} | {time.time() - t0:.0f} s")`),

  md(String.raw`## Training: YOLO26 n und s
Kein Spiegeln/Drehen (die 20 ist im entzerrten Bild immer oben, die Ecken haben feste Plätze), kein Mosaic (es würde das Board zerstückeln und die Ecken-Klassen zerstören). Geringe Farb- und Verschiebungs-Augmentierung wie bisher. Frühes Stoppen nach 15 Epochen ohne Besserung. Mit dem Original-Datensatz dauert eine Epoche etwa eine Minute (n) bzw. zwei (s): rechne mit 1-2 Stunden insgesamt.`),
  code(String.raw`VARIANTS = {
    "yolo26n": dict(weights="yolo26n.pt", epochs=45, batch=16),
    "yolo26s": dict(weights="yolo26s.pt", epochs=35, batch=16),
}
results = {}
for name, cfg in VARIANTS.items():
    m = YOLO(cfg["weights"])
    m.train(
        data=f"{MIX}/data.yaml", imgsz=800, epochs=cfg["epochs"], batch=cfg["batch"], patience=15, optimizer="AdamW", lr0=0.001, lrf=0.05,
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
