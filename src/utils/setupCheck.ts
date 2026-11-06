/**
 * The quick check right after a calibration: is the picture good enough for reliable detection?
 * Returns the single most important problem (or null), so the player gets one concrete hint instead of a list.
 */
export type SetupProblem = "dark" | "bright" | "flat" | "weakFit";

export const SETUP_LIMITS = {
  darkBrightness: 70,
  brightBrightness: 185,
  flatContrast: 30,
  weakFit: 0.6,
} as const;

export interface SetupFacts {
  brightness?: number;
  contrast?: number;
  /** How well the calibration sat on the wires, 0-1; undefined when it was not measured. */
  calibQuality?: number | null;
}

export const assessSetup = (facts: SetupFacts): SetupProblem | null => {
  const { brightness, contrast, calibQuality } = facts;
  if (brightness !== undefined && brightness < SETUP_LIMITS.darkBrightness) return "dark";
  if (brightness !== undefined && brightness > SETUP_LIMITS.brightBrightness) return "bright";
  if (contrast !== undefined && contrast < SETUP_LIMITS.flatContrast) return "flat";
  if (typeof calibQuality === "number" && calibQuality < SETUP_LIMITS.weakFit) return "weakFit";
  return null;
};
