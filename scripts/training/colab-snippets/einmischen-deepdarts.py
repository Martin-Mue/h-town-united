import itertools, random, pandas as pd

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
        open(f"/content/dd/labels/train/{name}.txt", "w").write("\n".join(lines) + "\n")
        written += 1
    shutil.rmtree("/content/ddraw", ignore_errors=True); shutil.rmtree("/content/ddprobe", ignore_errors=True)
    os.makedirs("/content/mix", exist_ok=True)
    MIX = "/content/mix"
    with open(f"{MIX}/data.yaml", "w") as f:
        f.write("\n".join([f"path: /content", f"train: [{DS}/images/train, /content/dd/images/train]", f"val: {DS}/images/val", "names:",
                           "  0: dart", "  1: cal_1", "  2: cal_2", "  3: cal_3", "  4: cal_4", ""]))
    print(f"DeepDarts-Bilder eingemischt: {written} | Trainingsbilder insgesamt: {len(glob.glob(DS + '/images/train/*.jpg')) + written} | {time.time() - t0:.0f} s")
