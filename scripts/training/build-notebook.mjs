// Generates finetune-dart-model.ipynb. The Python source lives in String.raw blocks so that
// "\n" inside the Python code stays a backslash-n instead of becoming a real line break.
import fs from "node:fs";

const toSource = (text) => text.split("\n").map((line, i, all) => (i < all.length - 1 ? line + "\n" : line));
const md = (text) => ({ cell_type: "markdown", metadata: {}, source: toSource(text) });
const code = (text) => ({ cell_type: "code", metadata: {}, execution_count: null, outputs: [], source: toSource(text) });

const cells = [
  md(String.raw`# DartSpot: Fine-Tuning des Dart-Erkennungsmodells

Vorher in Colab: **Laufzeit → Laufzeittyp ändern → GPU (T4)**.

Dein altes Modell wird direkt aus Google Drive geladen (DeepDarts-Dataset/training_runs/dart_yolov8n/weights/best.pt). Hochladen musst du nur training-set-yolo.zip (vom Skript build-yolo-dataset.mjs).

Das Notebook (1) beschriftet die vier Kalibrier-Ecken mit dem alten Modell nach, damit sie nicht verlernt werden, (2) misst das alte Modell auf deinen Prüfbildern, (3) trainiert kurz mit niedriger Lernrate, (4) misst erneut und (5) exportiert best.onnx (800x800).`),

  code(String.raw`!pip -q install ultralytics
from google.colab import drive, files
import os, shutil, zipfile

drive.mount("/content/drive")
OLD_PT = "/content/drive/MyDrive/DeepDarts-Dataset/training_runs/dart_yolov8n/weights/best.pt"
assert os.path.exists(OLD_PT), "best.pt nicht gefunden - Pfad in OLD_PT anpassen"
shutil.copy(OLD_PT, "/content/best.pt")  # Original in Drive bleibt unberührt

print("Lade training-set-yolo.zip hoch:")
uploaded = files.upload()
assert "training-set-yolo.zip" in uploaded, "training-set-yolo.zip fehlt"
zipfile.ZipFile("training-set-yolo.zip").extractall("/content/ds")
DS = "/content/ds" if os.path.exists("/content/ds/data.yaml") else "/content/ds/training-set-yolo"
print("Datensatz:", DS, os.listdir(DS))`),

  md(String.raw`## 1. Kalibrier-Ecken nachbeschriften
Dein Datensatz kennt nur die Klasse dart (0). Die Ecken cal_1..cal_4 (1..4) sind im Bild aber sichtbar. Ohne Labels würde YOLO sie als "nichts" lernen. Das alte Modell beschriftet sie deshalb selbst, aber nur, wenn es alle vier sicher findet.`),

  code(String.raw`from ultralytics import YOLO
import glob

old = YOLO("/content/best.pt")
print(old.names)  # erwartet: {0: dart, 1: cal_1, ... 4: cal_4}

added = skipped = 0
for split in ["train", "val"]:
    for img in sorted(glob.glob(f"{DS}/images/{split}/*.jpg")):
        res = old.predict(img, imgsz=800, conf=0.5, verbose=False)[0]
        best = {}
        for b in res.boxes:
            c = int(b.cls)
            if c in (1, 2, 3, 4) and (c not in best or float(b.conf) > best[c][0]):
                best[c] = (float(b.conf), b.xywhn[0].tolist())
        if len(best) == 4:
            lbl = img.replace("/images/", "/labels/").rsplit(".", 1)[0] + ".txt"
            with open(lbl, "a") as f:
                for c, (_, xywh) in sorted(best.items()):
                    f.write(f"{c} " + " ".join(f"{v:.6f}" for v in xywh) + "\n")
            added += 1
        else:
            skipped += 1
print(f"Ecken ergänzt bei {added} Bildern, übersprungen (nicht alle 4 sicher): {skipped}")

yaml_lines = [f"path: {DS}", "train: images/train", "val: images/val", "names:",
              "  0: dart", "  1: cal_1", "  2: cal_2", "  3: cal_3", "  4: cal_4", ""]
with open(f"{DS}/data.yaml", "w") as f:
    f.write("\n".join(yaml_lines))`),

  md(String.raw`## 2. Vorher-Messung
Die Werte merken: Wichtig ist dart (Zeile mit mAP50) und dass cal_* nicht einbrechen.`),

  code(String.raw`before = old.val(data=f"{DS}/data.yaml", imgsz=800, plots=False)
print("VORHER  dart mAP50:", before.box.ap50[0], " alle Klassen mAP50:", before.box.map50)`),

  md(String.raw`## 3. Nachtrainieren
Niedrige Lernrate, Backbone (erste 10 Schichten) eingefroren, kein Spiegeln (das würde die Ecken vertauschen). patience stoppt früh, wenn es nicht besser wird.`),

  code(String.raw`model = YOLO("/content/best.pt")
model.train(
    data=f"{DS}/data.yaml", imgsz=800, epochs=40, batch=16,
    lr0=0.002, lrf=0.1, optimizer="AdamW", freeze=10, patience=12,
    fliplr=0.0, flipud=0.0, degrees=5, scale=0.25, mosaic=0.5, close_mosaic=8,
    project="runs", name="dartspot_ft", exist_ok=True,
)`),

  md(String.raw`## 4. Nachher-Messung und Entscheidung`),

  code(String.raw`new = YOLO("runs/dartspot_ft/weights/best.pt")
after = new.val(data=f"{DS}/data.yaml", imgsz=800, plots=False)
print("VORHER  dart mAP50:", before.box.ap50[0], " alle:", before.box.map50)
print("NACHHER dart mAP50:", after.box.ap50[0], " alle:", after.box.map50)
for i, n in new.names.items():
    print(f"{n:7s} vorher {before.box.ap50[i]:.3f}  nachher {after.box.ap50[i]:.3f}")
print()
print("Nur übernehmen, wenn dart deutlich besser ist UND cal_1..cal_4 nicht schlechter werden.")`),

  md(String.raw`## 5. Export für die App
Erzeugt best.onnx (800x800). In der App ersetzt du public/models/best.onnx damit; das alte Modell vorher aufheben.`),

  code(String.raw`onnx_path = new.export(format="onnx", imgsz=800, opset=12, simplify=True, dynamic=False)
from google.colab import files
files.download(onnx_path)
files.download("runs/dartspot_ft/weights/best.pt")  # neues .pt für das nächste Mal aufheben`),
];

const notebook = {
  cells,
  metadata: { kernelspec: { name: "python3", display_name: "Python 3" }, language_info: { name: "python" }, accelerator: "GPU" },
  nbformat: 4,
  nbformat_minor: 5,
};
fs.writeFileSync(new URL("./finetune-dart-model.ipynb", import.meta.url), JSON.stringify(notebook, null, 1));
console.log("wrote finetune-dart-model.ipynb");
