/**
 * How good was the camera detection? Two halves:
 *  - recording: at commit time, compare what the detector first reported for each dart with what the
 *    player finally confirmed, and boil that down to a small record stored in `calibration_meta.detection`;
 *  - evaluation: aggregate those records (and, for older samples that have none, the hints the
 *    final labels still carry) into the figures the admin quality view shows.
 */

/** Radius of the double ring's outer edge; board-unit coordinates (boardU/boardV) have 1 = this. */
export const DOUBLE_EDGE_MM = 170;
/** A tip nearer than this to where the detector put it counts as "not moved" (rounding noise). */
export const UNMOVED_TOLERANCE_MM = 1.5;
export const NEAR_TIP_MM = 8.5;
export const CLOSE_TIP_MM = 17;

export type DartOutcome = "unchanged" | "moved" | "valueChanged" | "added" | "addedMiss" | "flagged";

/** What the detector reported for a dart, frozen at the moment it was found. */
export interface DetectedSnapshot {
  baseValue: number;
  multiplier: number;
  confidence: number;
  boardU?: number;
  boardV?: number;
}

/** The parts of a committed dart this module needs. */
export interface FinalDart {
  /** The player left a wrongly recognised dart as it is and marked it for relabelling later. */
  flaggedWrong?: boolean;
  baseValue: number;
  multiplier: number;
  boardU?: number;
  boardV?: number;
  detected?: DetectedSnapshot;
}

export type DartRecord = {
  outcome: DartOutcome;
  /** Distance between detected and final tip; null when either position is unknown. */
  distanceMm: number | null;
  /** Detector confidence for this dart; null for darts the player added. */
  confidence: number | null;
  /** Distance in mm to the nearest other dart of the same round; null when there is none or a position is unknown. */
  neighborMm?: number | null;
};

/**
 * The circumstances of a round, so that good and bad rounds can be told apart by their conditions
 * instead of guessed about. All fields are optional: records made before this existed have none.
 */
export type RoundContext = {
  /** Mean brightness of the straightened board picture, 0-255. */
  brightness?: number;
  /** Spread of brightness (standard deviation, 0-128): low = flat, washed-out or very dark picture. */
  contrast?: number;
  /** How well the calibration sat on the board's wires at its last check, 0-1. */
  calibQuality?: number;
  /** How often the calibration was moved back onto the board while this round was played. */
  refits?: number;
  /** "auto" (found by the model) or "manual" (tapped by hand). */
  calibSource?: "auto" | "manual";
}

export type DetectionRecord = {
  version: 1;
  /** Model file version the detections came from (see DART_MODEL_VERSION). */
  model: string;
  darts: DartRecord[];
  /** Darts the detector reported that the player deleted. */
  removed: number;
  context?: RoundContext;
};

/** Brightness and contrast of a picture, sampled sparsely (about 4000 pixels) so it costs next to nothing. */
export const frameLuma = (img: { data: ArrayLike<number>; width: number; height: number }): { brightness: number; contrast: number } | null => {
  const pixels = img.width * img.height;
  if (pixels <= 0 || img.data.length < pixels * 4) return null;
  const step = Math.max(1, Math.floor(pixels / 4000));
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < pixels; i += step) {
    const o = i * 4;
    const y = 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2];
    sum += y;
    sumSq += y * y;
    n += 1;
  }
  const mean = sum / n;
  return { brightness: Math.round(mean), contrast: Math.round(Math.sqrt(Math.max(0, sumSq / n - mean * mean))) };
};

const finitePosition = (d: { boardU?: number; boardV?: number }) =>
  typeof d.boardU === "number" && Number.isFinite(d.boardU) && typeof d.boardV === "number" && Number.isFinite(d.boardV);

/** Distance from dart `index` to its nearest neighbour among the round's darts, in mm (tight groups are where detection struggles). */
export const nearestNeighborMm = (darts: { boardU?: number; boardV?: number }[], index: number): number | null => {
  const me = darts[index];
  if (!me || !finitePosition(me)) return null;
  let best: number | null = null;
  darts.forEach((other, k) => {
    if (k === index || !finitePosition(other)) return;
    const d = Math.hypot(me.boardU! - other.boardU!, me.boardV! - other.boardV!) * DOUBLE_EDGE_MM;
    if (best === null || d < best) best = d;
  });
  return best;
};

const tipDistanceMm = (a?: DetectedSnapshot, b?: FinalDart): number | null => {
  if (!a || !b) return null;
  if (![a.boardU, a.boardV, b.boardU, b.boardV].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return Math.hypot(a.boardU! - b.boardU!, a.boardV! - b.boardV!) * DOUBLE_EDGE_MM;
};

export const buildDetectionRecord = (
  finalDarts: FinalDart[],
  removedDetections: unknown[],
  model: string,
  context?: RoundContext,
): DetectionRecord => ({
  version: 1,
  model,
  removed: removedDetections.length,
  ...(context ? { context } : {}),
  darts: finalDarts.map((d, index): DartRecord => {
    const neighborMm = nearestNeighborMm(finalDarts, index);
    if (d.flaggedWrong) {
      return { outcome: "flagged", distanceMm: tipDistanceMm(d.detected, d), confidence: d.detected?.confidence ?? null, neighborMm };
    }
    if (!d.detected) {
      return { outcome: d.baseValue === 0 ? "addedMiss" : "added", distanceMm: null, confidence: null, neighborMm };
    }
    const distanceMm = tipDistanceMm(d.detected, d);
    const sameValue = d.detected.baseValue === d.baseValue && d.detected.multiplier === d.multiplier;
    const outcome: DartOutcome = !sameValue
      ? "valueChanged"
      : distanceMm !== null && distanceMm > UNMOVED_TOLERANCE_MM
        ? "moved"
        : "unchanged";
    return { outcome, distanceMm, confidence: d.detected.confidence, neighborMm };
  }),
});

// ─── evaluation ──────────────────────────────────────────────────────

/** One stored training sample, reduced to what the evaluation reads. */
export interface QualitySample {
  createdAt: string;
  labels: { confidence?: number; snapped?: boolean }[];
  detection: DetectionRecord | null;
}

export interface OutcomeCounts {
  unchanged: number;
  moved: number;
  valueChanged: number;
  added: number;
  addedMiss: number;
  /** Darts the player marked as wrongly recognised and left uncorrected. */
  flagged: number;
  removed: number;
}

export interface QualityFigures {
  /** Rounds in the sample. */
  rounds: number;
  /** Darts that were detected or added in those rounds (removed ones not included). */
  darts: number;
  /** Rounds in which the player changed nothing. */
  untouchedRounds: number;
  counts: OutcomeCounts;
  /** Tip distances of the darts where it is known, in mm. */
  distances: number[];
}

const emptyCounts = (): OutcomeCounts => ({ unchanged: 0, moved: 0, valueChanged: 0, added: 0, addedMiss: 0, flagged: 0, removed: 0 });

/** A recorded round is untouched when every dart is unchanged and none was removed. */
const isUntouched = (r: DetectionRecord) => r.removed === 0 && r.darts.every((d) => d.outcome === "unchanged");

/** Figures over samples that carry a detection record (exact, includes distances). */
export const evaluateRecorded = (samples: QualitySample[]): QualityFigures => {
  const figures: QualityFigures = { rounds: 0, darts: 0, untouchedRounds: 0, counts: emptyCounts(), distances: [] };
  for (const s of samples) {
    if (!s.detection) continue;
    figures.rounds += 1;
    if (isUntouched(s.detection)) figures.untouchedRounds += 1;
    figures.counts.removed += s.detection.removed;
    for (const d of s.detection.darts) {
      figures.darts += 1;
      figures.counts[d.outcome] += 1;
      if (d.distanceMm !== null) figures.distances.push(d.distanceMm);
    }
  }
  return figures;
};

/** Detector confidence is exactly 1 only for darts a person pointed at or added by hand. */
const isHumanConfidence = (c: number | undefined) => typeof c === "number" && c >= 0.999;

/**
 * Before this date the stored confidence is 1 for almost every dart (older code wrote the confirmed value),
 * so it says nothing about whether a person touched the dart.
 */
export const CONFIDENCE_MEANINGFUL_FROM = "2026-10-19";

export interface LegacyFigures {
  /** Older samples whose confidence is not meaningful: counted, but not evaluated. */
  unusableRounds: number;
  rounds: number;
  darts: number;
  /** Darts whose score was picked from the correction chips. */
  valueCorrected: number;
  /** Darts a person positioned or added (confidence 1), snapped ones excluded. */
  handPlaced: number;
  /** Darts still carrying the detector's own reading. */
  detectorOnly: number;
  /** Rounds in which every dart is still the detector's own reading. */
  untouchedRounds: number;
}

/** Figures over older samples without a record: only what the final labels still hint at. */
export const evaluateLegacy = (samples: QualitySample[]): LegacyFigures => {
  const f: LegacyFigures = { unusableRounds: 0, rounds: 0, darts: 0, valueCorrected: 0, handPlaced: 0, detectorOnly: 0, untouchedRounds: 0 };
  for (const s of samples) {
    if (s.detection) continue;
    if (s.createdAt < CONFIDENCE_MEANINGFUL_FROM) {
      f.unusableRounds += 1;
      continue;
    }
    f.rounds += 1;
    let touched = false;
    for (const l of s.labels) {
      f.darts += 1;
      if (l.snapped) {
        f.valueCorrected += 1;
        touched = true;
      } else if (isHumanConfidence(l.confidence)) {
        f.handPlaced += 1;
        touched = true;
      } else {
        f.detectorOnly += 1;
      }
    }
    if (!touched) f.untouchedRounds += 1;
  }
  return f;
};

export const share = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

export const meanOf = (values: number[]): number | null =>
  values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** Share of distances at or below `limitMm`. */
export const shareWithin = (distances: number[], limitMm: number): number | null =>
  share(distances.filter((d) => d <= limitMm).length, distances.length);

export interface PeriodFigures {
  /** ISO date of the period's Monday (week) or the day itself. */
  period: string;
  figures: QualityFigures;
}

const periodStart = (iso: string, by: "day" | "week"): string => {
  const d = new Date(iso);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (by === "week") day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
};

/** Recorded samples grouped by day or week, oldest first. */
export const groupByPeriod = (samples: QualitySample[], by: "day" | "week"): PeriodFigures[] => {
  const groups = new Map<string, QualitySample[]>();
  for (const s of samples) {
    if (!s.detection) continue;
    const key = periodStart(s.createdAt, by);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, group]) => ({ period, figures: evaluateRecorded(group) }));
};

/** Recorded samples grouped by the model version that produced the detections. */
export const groupByModel = (samples: QualitySample[]): { model: string; figures: QualityFigures }[] => {
  const groups = new Map<string, QualitySample[]>();
  for (const s of samples) {
    if (!s.detection) continue;
    groups.set(s.detection.model, [...(groups.get(s.detection.model) ?? []), s]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, group]) => ({ model, figures: evaluateRecorded(group) }));
};

/** Neighbour-distance buckets, nearest first. */
export const NEIGHBOR_BUCKETS: { label: string; matches: (mm: number) => boolean }[] = [
  { label: "Kopf an Kopf (<12 mm)", matches: (mm) => mm < 12 },
  { label: "eng (12–25 mm)", matches: (mm) => mm >= 12 && mm < 25 },
  { label: "mittel (25–50 mm)", matches: (mm) => mm >= 25 && mm < 50 },
  { label: "frei (≥50 mm)", matches: (mm) => mm >= 50 },
];

export interface NeighborRow {
  label: string;
  darts: number;
  unchanged: number;
  flagged: number;
  /** Corrected by the player in any way (moved, value changed). */
  corrected: number;
}

/** How often darts were right, wrongly marked or corrected, by how close the next dart sat. */
export const groupByNeighborDistance = (samples: QualitySample[]): NeighborRow[] => {
  const rows: NeighborRow[] = NEIGHBOR_BUCKETS.map((b) => ({ label: b.label, darts: 0, unchanged: 0, flagged: 0, corrected: 0 }));
  for (const s of samples) {
    for (const d of s.detection?.darts ?? []) {
      if (typeof d.neighborMm !== "number") continue;
      const i = NEIGHBOR_BUCKETS.findIndex((b) => b.matches(d.neighborMm!));
      if (i < 0) continue;
      rows[i].darts += 1;
      if (d.outcome === "unchanged") rows[i].unchanged += 1;
      else if (d.outcome === "flagged") rows[i].flagged += 1;
      else if (d.outcome === "moved" || d.outcome === "valueChanged") rows[i].corrected += 1;
    }
  }
  return rows.filter((r) => r.darts > 0);
};

/** Condition buckets the admin view splits rounds by; each returns null when the record lacks that fact. */
export const CONDITION_SPLITS: { id: string; title: string; bucket: (c: RoundContext) => string | null }[] = [
  {
    id: "brightness",
    title: "Helligkeit",
    bucket: (c) => (c.brightness === undefined ? null : c.brightness < 80 ? "dunkel (<80)" : c.brightness > 170 ? "sehr hell (>170)" : "mittel (80–170)"),
  },
  {
    id: "contrast",
    title: "Kontrast",
    bucket: (c) => (c.contrast === undefined ? null : c.contrast < 35 ? "flach (<35)" : "normal (≥35)"),
  },
  {
    id: "calibQuality",
    title: "Kalibriersitz",
    bucket: (c) => (c.calibQuality === undefined ? null : c.calibQuality < 0.6 ? "schwach (<0,6)" : c.calibQuality < 0.8 ? "ok (0,6–0,8)" : "stark (≥0,8)"),
  },
  {
    id: "refits",
    title: "Nachkalibrierungen in der Runde",
    bucket: (c) => (c.refits === undefined ? null : c.refits === 0 ? "keine" : "mindestens eine"),
  },
  {
    id: "calibSource",
    title: "Kalibrierung",
    bucket: (c) => (c.calibSource === undefined ? null : c.calibSource === "auto" ? "automatisch" : "von Hand"),
  },
];

/** Recorded samples split by one condition; samples without that fact are left out. */
export const groupByCondition = (
  samples: QualitySample[],
  bucket: (c: RoundContext) => string | null,
): { label: string; figures: QualityFigures }[] => {
  const groups = new Map<string, QualitySample[]>();
  for (const s of samples) {
    if (!s.detection?.context) continue;
    const label = bucket(s.detection.context);
    if (label === null) continue;
    groups.set(label, [...(groups.get(label) ?? []), s]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, group]) => ({ label, figures: evaluateRecorded(group) }));
};

const finiteOrUndefined = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const parseContext = (raw: unknown): RoundContext | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const context: RoundContext = {
    brightness: finiteOrUndefined(r.brightness),
    contrast: finiteOrUndefined(r.contrast),
    calibQuality: finiteOrUndefined(r.calibQuality),
    refits: finiteOrUndefined(r.refits),
    calibSource: r.calibSource === "auto" || r.calibSource === "manual" ? r.calibSource : undefined,
  };
  return Object.values(context).some((v) => v !== undefined) ? context : undefined;
};

/** Reads `calibration_meta.detection` defensively: older or foreign shapes give null. */
export const parseDetectionRecord = (meta: unknown): DetectionRecord | null => {
  const raw = (meta as { detection?: unknown } | null)?.detection as Partial<DetectionRecord> | undefined;
  if (!raw || raw.version !== 1 || !Array.isArray(raw.darts)) return null;
  return {
    version: 1,
    model: typeof raw.model === "string" ? raw.model : "unbekannt",
    removed: typeof raw.removed === "number" ? raw.removed : 0,
    context: parseContext(raw.context),
    darts: raw.darts.filter((d): d is DartRecord => !!d && typeof d.outcome === "string"),
  };
};
