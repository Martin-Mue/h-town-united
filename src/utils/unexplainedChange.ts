/**
 * "The board looks different from the empty board, yet the model found no dart": a dart that stands in the board but
 * scores too low (a thin tip at the edge, a dart hidden by its own flight) used to be treated as an EMPTY board at the next
 * rest — the empty-board baseline was then refreshed WITH the dart in it and the round ended without a single dart,
 * silently. This decides when a picture differs from the baseline enough to be darts (and not noise, light or a hand).
 */

/** Below this share of changed grid cells (of 100x100) the difference is sensor noise or a shadow, not a dart. */
export const UNEXPLAINED_CHANGE_MIN_SHARE = 0.003;
/** Above this a hand, an exposure jump or a bumped phone moved the picture — no statement possible. */
export const UNEXPLAINED_CHANGE_MAX_SHARE = 0.25;
/** How many rests in a row must show the difference before the player is told. */
export const UNEXPLAINED_LOOKS_BEFORE_HINT = 2;
/** After this many the old behaviour returns (refresh the baseline) so a lasting lighting change cannot freeze the camera. */
export const UNEXPLAINED_LOOKS_GIVE_UP = 6;

export const looksLikeUndetectedDarts = (shareVsEmptyBoard: number): boolean =>
  shareVsEmptyBoard >= UNEXPLAINED_CHANGE_MIN_SHARE && shareVsEmptyBoard < UNEXPLAINED_CHANGE_MAX_SHARE;
