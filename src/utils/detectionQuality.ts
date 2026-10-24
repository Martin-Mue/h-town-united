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

export type DartOutcome = "unchanged" | "moved" | "valueChanged" | "added" | "addedMiss";

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
  baseValue: number;
  multiplier: number;
  boardU?: number;
  boardV?: number;
  detected?: DetectedSnapshot;
}

export interface DartRecord {
  outcome: DartOutcome;
  /** Distance between detected and final tip; null when either position is unknown. */
  distanceMm: number | null;
  /** Detector confidence for this dart; null for darts the player added. */
  confidence: number | null;
}

export interface DetectionRecord {
  version: 1;
  /** Model file version the detections came from (see DART_MODEL_VERSION). */
  model: string;
  darts: DartRecord[];
  /** Darts the detector reported that the player deleted. */
  removed: number;
}

const tipDistanceMm = (a?: DetectedSnapshot, b?: FinalDart): number | null => {
  if (!a || !b) return null;
  if (![a.boardU, a.boardV, b.boardU, b.boardV].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return Math.hypot(a.boardU! - b.boardU!, a.boardV! - b.boardV!) * DOUBLE_EDGE_MM;
};

export const buildDetectionRecord = (
  finalDarts: FinalDart[],
  removedDetections: unknown[],
  model: string,
): DetectionRecord => ({
  version: 1,
  model,
  removed: removedDetections.length,
  darts: finalDarts.map((d): DartRecord => {
    if (!d.detected) {
      return { outcome: d.baseValue === 0 ? "addedMiss" : "added", distanceMm: null, confidence: null };
    }
    const distanceMm = tipDistanceMm(d.detected, d);
    const sameValue = d.detected.baseValue === d.baseValue && d.detected.multiplier === d.multiplier;
    const outcome: DartOutcome = !sameValue
      ? "valueChanged"
      : distanceMm !== null && distanceMm > UNMOVED_TOLERANCE_MM
        ? "moved"
        : "unchanged";
    return { outcome, distanceMm, confidence: d.detected.confidence };
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

const emptyCounts = (): OutcomeCounts => ({ unchanged: 0, moved: 0, valueChanged: 0, added: 0, addedMiss: 0, removed: 0 });

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

export interface LegacyFigures {
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
  const f: LegacyFigures = { rounds: 0, darts: 0, valueCorrected: 0, handPlaced: 0, detectorOnly: 0, untouchedRounds: 0 };
  for (const s of samples) {
    if (s.detection) continue;
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

/** Reads `calibration_meta.detection` defensively: older or foreign shapes give null. */
export const parseDetectionRecord = (meta: unknown): DetectionRecord | null => {
  const raw = (meta as { detection?: unknown } | null)?.detection as Partial<DetectionRecord> | undefined;
  if (!raw || raw.version !== 1 || !Array.isArray(raw.darts)) return null;
  return {
    version: 1,
    model: typeof raw.model === "string" ? raw.model : "unbekannt",
    removed: typeof raw.removed === "number" ? raw.removed : 0,
    darts: raw.darts.filter((d): d is DartRecord => !!d && typeof d.outcome === "string"),
  };
};
