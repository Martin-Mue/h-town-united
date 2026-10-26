/**
 * A small log of what the camera saw and decided at each rest of the board ("look"): which candidates the model had, how
 * strongly fresh pixels stood under each, and which one became a dart. Rounds in which nothing was recognised leave no
 * training picture, so without this the reason can only be guessed. Kept on the device (last LIMIT looks), exported as a
 * json file from the camera settings; nothing is sent anywhere.
 */
export interface LoggedCandidate {
  x: number;
  y: number;
  score: number;
  /** Share of changed pixels around the tip (0-1), null without a comparison picture. */
  support: number | null;
  /** Distance to the nearest known dart of this round in mm on the board, null when there is none. */
  nearestKnownMm: number | null;
  picked: boolean;
}

export interface DetectionLogEntry {
  at: string;
  zoom: number;
  /** Darts of the current round the camera already knew before this look. */
  known: number;
  /** Highest score the model gave anywhere in the picture (also below every threshold), null when it returned nothing. */
  bestRawScore: number | null;
  rawCount: number;
  /** Share of the picture that changed since the last stable picture. */
  changeShare: number | null;
  outcome: "dart-added" | "nothing-added" | "board-empty";
  candidates: LoggedCandidate[];
}

const KEY = "dartcam-detection-log-v1";
const LIMIT = 150;

const read = (): DetectionLogEntry[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export function logDetectionLook(entry: Omit<DetectionLogEntry, "at">): void {
  try {
    const all = read();
    all.push({ at: new Date().toISOString(), ...entry });
    window.localStorage.setItem(KEY, JSON.stringify(all.slice(-LIMIT)));
  } catch {
    /* storage full or blocked: the log is a convenience, never a reason to fail a scan */
  }
}

export const detectionLogCount = (): number => read().length;

export function exportDetectionLog(): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), entries: read() }, null, 1);
}

export function clearDetectionLog(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
export const roundForLog = { score: (v: number) => round(v, 2), pos: (v: number) => round(v, 3), mm: (v: number) => Math.round(v) };
