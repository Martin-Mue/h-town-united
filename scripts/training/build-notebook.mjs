// Generates finetune-dart-model.ipynb. The Python source lives in String.raw blocks so that
// "\n" inside the Python code stays a backslash-n instead of becoming a real line break.
import fs from "node:fs";

const toSource = (text) => text.split("\n").map((line, i, all) => (i < all.length - 1 ? line + "\n" : line));
const md = (text) => ({ cell_type: "markdown", metadata: {}, source: toSource(text) });
const code = (text) => ({ cell_type: "code", metadata: {}, execution_count: null, outputs: [], source: toSource(text) });

const cells = [
  md(String.raw`# DartSpot: Fine-Tuning des Dart-Erkennungsmodells (v2 – Dartspitze)

Vorher in Colab: **Laufzeit → Laufzeittyp ändern → GPU (T4)**. Danach **Laufzeit → Alle ausführen** – ein Durchlauf, keine Zwischenschritte.

Dein altes Modell wird aus Google Drive geladen (DeepDarts-Dataset/training_runs/dart_yolov8n/weights/best.pt). Hochladen musst du nur das Datenset (training-set-rectified.zip).

Was anders ist als beim ersten Versuch:
- Die Bilder sind genau das, was die App dem Modell zeigt: das Board von oben entzerrt (20 oben), die vier Ecken sind echte Labels.
- Die Dart-Labels liegen auf der **Dartspitze** (nicht auf dem Flight), mit einer größeren Box (6 % der Bildbreite), damit die Messlatte nicht an winzigen Boxen scheitert.
- Gemessen wird **der Abstand zur echten Spitze in Millimetern** (nicht AP50): wie viele Darts liegen innerhalb von 8,5 / 17 / 34 mm?
- Zwei Trainingsvarianten laufen nacheinander, das beste Modell (nach Spitzenfehler) wird automatisch exportiert.`),

  code(String.raw`!pip -q install ultralytics
from google.colab import drive, files
import os, shutil, zipfile

drive.mount("/content/drive")
OLD_PT = "/content/drive/MyDrive/DeepDarts-Dataset/training_runs/dart_yolov8n/weights/best.pt"
assert os.path.exists(OLD_PT), "best.pt nicht gefunden - Pfad in OLD_PT anpassen"
shutil.copy(OLD_PT, "/content/best.pt")  # Original in Drive bleibt unberührt

print("Lade training-set-rectified.zip hoch:")
uploaded = files.upload()
zip_names = [n for n in uploaded if n.lower().endswith(".zip")]
assert zip_names, "Keine .zip hochgeladen"
shutil.rmtree("/content/ds", ignore_errors=True)  # frisch entpacken, auch bei erneutem Ausführen
zipfile.ZipFile(zip_names[0]).extractall("/content/ds")
# Zips made with Windows PowerShell store paths with backslashes; move such files into real folders.
for name in os.listdir("/content/ds"):
    if "\\" in name:
        target = os.path.join("/content/ds", name.replace("\\", "/"))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.move(os.path.join("/content/ds", name), target)
DS = "/content/ds" if os.path.exists("/content/ds/data.yaml") else "/content/ds/training-set-rectified"
with open(f"{DS}/data.yaml", "w") as f:
    f.write("\n".join([f"path: {DS}", "train: images/train", "val: images/val", "names:",
                       "  0: dart", "  1: cal_1", "  2: cal_2", "  3: cal_3", "  4: cal_4", ""]))
print("Datensatz:", DS, os.listdir(DS))`),

  md(String.raw`## Messung: Abstand zur echten Dartspitze
Das Board hat im entzerrten Bild einen Radius von 0,377 der Bildbreite = 170 mm. Daraus rechnen wir Pixelabstände in Millimeter um. Verglichen wird die Mitte der gefundenen Box mit dem Spitzen-Label (jeder echte Dart wird dem nächstgelegenen Fund zugeordnet).`),

  code(String.raw`import glob, math
from ultralytics import YOLO

MM_PER_UNIT = 170 / 0.377   # Millimeter je Bildbreite im entzerrten Bild

def read_darts(label_file):
    out = []
    for ln in open(label_file).read().splitlines():
        p = ln.split()
        if p and p[0] == "0":
            out.append((float(p[1]), float(p[2])))
    return out

def tip_metrics(model, split="val", conf=0.12):
    # conf=0.12 wie in der App: dort zaehlt auch ein schwacher Fund, wenn er auf veraenderten Pixeln liegt
    errors, n_pred, n_gt = [], 0, 0
    for img in sorted(glob.glob(f"{DS}/images/{split}/*.jpg")):
        gt = read_darts(img.replace("/images/", "/labels/").rsplit(".", 1)[0] + ".txt")
        res = model.predict(img, imgsz=800, conf=conf, verbose=False)[0]
        preds = [(float(b.xywhn[0][0]), float(b.xywhn[0][1])) for b in res.boxes if int(b.cls) == 0]
        n_pred += len(preds); n_gt += len(gt)
        free = preds[:]
        for g in gt:
            if not free:
                errors.append(float("inf")); continue
            j = min(range(len(free)), key=lambda k: math.hypot(free[k][0] - g[0], free[k][1] - g[1]))
            errors.append(math.hypot(free[j][0] - g[0], free[j][1] - g[1]) * MM_PER_UNIT)
            free.pop(j)
    finite = sorted(e for e in errors if e != float("inf"))
    within = lambda mm: sum(1 for e in errors if e <= mm) / max(1, len(errors))
    return {
        "darts": n_gt, "found": len(finite), "extra_detections": max(0, n_pred - len(finite)),
        "median_mm": finite[len(finite) // 2] if finite else None,
        "r8": within(8.5), "r17": within(17), "r34": within(34),
    }

def ap50_by_class(metrics):
    return {int(c): float(a) for c, a in zip(metrics.box.ap_class_index, metrics.box.ap50)}

def show(name, m):
    med = "-" if m["median_mm"] is None else f"{m['median_mm']:.1f} mm"
    print(f"{name:14s} gefunden {m['found']}/{m['darts']}  Median {med:>9s}  "
          f"<=8.5mm {m['r8']*100:4.0f}%  <=17mm {m['r17']*100:4.0f}%  <=34mm {m['r34']*100:4.0f}%  zusaetzliche Funde {m['extra_detections']}")`),

  md(String.raw`## Vorher-Messung (altes Modell)`),

  code(String.raw`old = YOLO("/content/best.pt")
old_tip = tip_metrics(old)
old_ap = ap50_by_class(old.val(data=f"{DS}/data.yaml", imgsz=800, plots=False))
show("ALT", old_tip)
print("ALT AP50 je Klasse:", {old.names[c]: round(a, 3) for c, a in old_ap.items()})`),

  md(String.raw`## Training – zwei Varianten
**A** friert den Backbone ein (sanft, behält viel vom alten Wissen), **B** trainiert alles mit kleiner Lernrate (kann die neue Ansicht – entzerrt von oben – besser lernen). Kein Spiegeln und Drehen: die 20 ist im entzerrten Bild immer oben, die Ecken haben feste Plätze.`),

  code(String.raw`CONFIGS = {
    "A_frozen": dict(freeze=10, lr0=0.002, epochs=60),
    "B_full":   dict(freeze=0,  lr0=0.001, epochs=80),
}
results = {}
for name, cfg in CONFIGS.items():
    m = YOLO("/content/best.pt")
    m.train(
        data=f"{DS}/data.yaml", imgsz=800, batch=16, lrf=0.1, optimizer="AdamW", patience=20,
        fliplr=0.0, flipud=0.0, degrees=0.0, translate=0.05, scale=0.15, shear=0.0, perspective=0.0,
        mosaic=0.0, mixup=0.0, hsv_h=0.01, hsv_s=0.5, hsv_v=0.35,
        project="/content/runs", name=name, exist_ok=True, plots=False, **cfg,
    )
    best_path = str(m.trainer.best)
    trained = YOLO(best_path)
    results[name] = {"path": best_path, "tip": tip_metrics(trained),
                     "ap": ap50_by_class(trained.val(data=f"{DS}/data.yaml", imgsz=800, plots=False))}
    show(name, results[name]["tip"])`),

  md(String.raw`## Ergebnis und Auswahl
Gewinner = höchste Trefferquote innerhalb 17 mm, aber nur, wenn die vier Ecken (cal_1..cal_4) nicht schlechter geworden sind als beim alten Modell.`),

  code(String.raw`show("ALT", old_tip)
for name, r in results.items():
    show(name, r["tip"])
    print("   AP50 je Klasse:", {YOLO(r["path"]).names[c]: round(a, 3) for c, a in r["ap"].items()})

def corners_ok(r):
    return all(r["ap"].get(c, 0) >= old_ap.get(c, 0) - 0.05 for c in (1, 2, 3, 4))

candidates = [(n, r) for n, r in results.items() if corners_ok(r)] or list(results.items())
WINNER, win = max(candidates, key=lambda kv: (kv[1]["tip"]["r17"], kv[1]["tip"]["r34"]))
print()
print("Gewinner:", WINNER)
better = win["tip"]["r17"] > old_tip["r17"] + 0.05
print("Deutlich besser als das alte Modell (>= +5 Prozentpunkte innerhalb 17 mm):", "JA" if better else "NEIN - altes Modell behalten und mir die Zahlen schicken")`),

  md(String.raw`## Export für die App
Erzeugt best.onnx (800x800) des Gewinners. Nur ersetzen, wenn oben "JA" steht – und das alte Modell vorher aufheben. Die Zahlen oben bitte kopieren und mir schicken.`),

  code(String.raw`final = YOLO(win["path"])
onnx_path = final.export(format="onnx", imgsz=800)
print("ONNX:", onnx_path)
shutil.copy(win["path"], "/content/drive/MyDrive/DeepDarts-Dataset/dartspot_tip_best.pt")  # Sicherung in Drive
from google.colab import files
files.download(onnx_path)
files.download(win["path"])`),
];

const notebook = {
  cells,
  metadata: { kernelspec: { name: "python3", display_name: "Python 3" }, language_info: { name: "python" }, accelerator: "GPU" },
  nbformat: 4,
  nbformat_minor: 5,
};
fs.writeFileSync(new URL("./finetune-dart-model.ipynb", import.meta.url), JSON.stringify(notebook, null, 1));
console.log("wrote finetune-dart-model.ipynb");
