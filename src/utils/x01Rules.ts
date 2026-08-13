/** A dart counts as a "double" for double-in/double-out purposes whenever its multiplier is
 *  2 — that's true for an outer double ring hit and for bullseye alike (bullseye is encoded
 *  as baseValue 25, multiplier 2), so no separate bullseye case is needed. */
export function isQualifyingDouble(multiplier: number): boolean {
  return multiplier === 2;
}

/**
 * Standard X01 bust rule, shared by manual entry, camera-detected scoring, and the bot player
 * so the three can never drift out of sync again:
 *  - going below zero always busts
 *  - landing on exactly 1 only busts under double-out (single-out can finish a 1 next visit)
 *  - landing on exactly 0 without finishing on a qualifying double busts, but only when
 *    double-out is actually required
 */
export function isBustThrow(remaining: number, points: number, doubleOut: boolean, isDouble: boolean): boolean {
  const newRemaining = remaining - points;
  if (newRemaining < 0) return true;
  if (newRemaining === 1 && doubleOut) return true;
  if (newRemaining === 0 && doubleOut && !isDouble) return true;
  return false;
}
