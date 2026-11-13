/** A start value outside this range gives no playable game (0 would start a leg that is already over). */
export const MIN_CUSTOM_START = 2;
export const MAX_CUSTOM_START = 9999;

/** The usual other X01 distances, one tap each; anything else goes into the field. */
export const CUSTOM_START_PRESETS = [101, 170, 701, 1001];

/** The start score a custom game really begins with: the typed value if it is playable, else 501. */
export const clampCustomStart = (score: number): number =>
  Number.isFinite(score) && score >= MIN_CUSTOM_START ? Math.min(MAX_CUSTOM_START, Math.round(score)) : 501;
