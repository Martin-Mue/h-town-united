// Generates check-cal-points.ipynb: shows where the old model's cal_1..cal_4 sit compared with the
// ground-truth calibration points of the original DeepDarts training data. The Python source lives
// in String.raw blocks so "\n" and quotes inside it stay exactly as written.
import fs from "node:fs";

const toSource = (text) => text.split("\n").map((line, i, all) => (i < all.length - 1 ? line + "\n" : line));
const md = (text) => ({ cell_type: "markdown", metadata: {}, source: toSource(text) });
const code = (text) => ({ cell_type: "code", metadata: {}, execution_count: null, outputs: [], source: toSource(text) });

const cells = [
  md(String.raw`# Was markieren cal_1 bis cal_4 beim alten Modell?

Die App geht davon aus, dass die vier Ecken in der Mitte von Doppel 20, 6, 3 und 11 liegen (0°, 90°, 180°, 270°). Das ursprüngliche DeepDarts-Modell markiert vermutlich die Drahtkreuzungen daneben (etwa 9° versetzt). Dieses Notebook zeigt es an Bildern aus deinem Originaltraining:

- **grün, Zahl 1-4** = die Soll-Punkte aus deinen Trainingsdaten (labels.pkl)
- **rot, cal_1..cal_4** = was das alte Modell tatsächlich vorhersagt

Schau, ob die Punkte in der Mitte eines Doppelfeldes oder auf einer Drahtlinie zwischen zwei Feldern sitzen. Es wird keine GPU gebraucht.`),

  code(String.raw`!pip -q install ultralytics
from google.colab import drive
import glob, os, random
drive.mount("/content/drive")
ROOT = "/content/drive/MyDrive/DeepDarts-Dataset"
OLD_PT = ROOT + "/training_runs/dart_yolov8n/weights/best.pt"
assert os.path.exists(OLD_PT), "best.pt nicht gefunden"
pkls = glob.glob(ROOT + "/**/labels.pkl", recursive=True)
imgs = glob.glob(ROOT + "/**/*.JPG", recursive=True) + glob.glob(ROOT + "/**/*.jpg", recursive=True)
print("labels.pkl:", pkls)
print("Bilder gefunden:", len(imgs), imgs[:2])
assert pkls and imgs, "labels.pkl oder Bilder fehlen im Drive-Ordner DeepDarts-Dataset"`),

  code(String.raw`import pandas as pd, numpy as np
import matplotlib.pyplot as plt
from PIL import Image
from ultralytics import YOLO

model = YOLO(OLD_PT)
df = pd.read_pickle(pkls[0])
print(df.columns.tolist())
print(df.iloc[0])

by_folder_name = {}
for p in imgs:
    by_folder_name[(os.path.basename(os.path.dirname(p)), os.path.basename(p))] = p

def find_image(row):
    return by_folder_name.get((str(row["img_folder"]), str(row["img_name"])))

rows = df.sample(6, random_state=3)
fig, axes = plt.subplots(2, 3, figsize=(18, 12))
for ax, (_, row) in zip(axes.ravel(), rows.iterrows()):
    path = find_image(row)
    if path is None:
        ax.set_title("Bild nicht gefunden"); ax.axis("off"); continue
    im = Image.open(path).convert("RGB")
    W, H = im.size
    ax.imshow(im)
    xy = np.array(row["xy"])
    for k in range(min(4, len(xy))):
        ax.scatter(xy[k][0] * W, xy[k][1] * H, s=140, facecolors="none", edgecolors="lime", linewidths=2)
        ax.text(xy[k][0] * W + 8, xy[k][1] * H - 8, str(k + 1), color="lime", fontsize=16, weight="bold")
    res = model.predict(path, imgsz=800, conf=0.25, verbose=False)[0]
    for b in res.boxes:
        c = int(b.cls)
        if c in (1, 2, 3, 4):
            cx, cy = b.xywhn[0][0].item() * W, b.xywhn[0][1].item() * H
            ax.scatter(cx, cy, s=60, c="red")
            ax.text(cx + 8, cy + 24, model.names[c], color="red", fontsize=14, weight="bold")
    ax.set_title(os.path.basename(path)); ax.axis("off")
plt.tight_layout(); plt.show()`),

  md(String.raw`## Auswertung
- Liegen die **grünen Punkte mitten in einem Doppelfeld** (z. B. mitten im roten oder grünen Streifen von Doppel 20 oben)? Dann passt die App-Annahme.
- Liegen sie **auf der Drahtlinie zwischen zwei Doppelfeldern**? Dann ist die automatische Kalibrierung bisher um ein halbes Segment verdreht.
- Liegen die **roten Punkte auf den grünen**? Dann hat das Modell die Definition korrekt gelernt, und die Nummern 1-4 zeigen, welche Ecke welche ist (Grundlage für CAL_ROLE_MAP in der App).

Schick mir einen Screenshot der Ausgabe.`),
];

const notebook = {
  cells,
  metadata: { kernelspec: { name: "python3", display_name: "Python 3" }, language_info: { name: "python" } },
  nbformat: 4,
  nbformat_minor: 5,
};
fs.writeFileSync(new URL("./check-cal-points.ipynb", import.meta.url), JSON.stringify(notebook, null, 1));
console.log("wrote check-cal-points.ipynb");
