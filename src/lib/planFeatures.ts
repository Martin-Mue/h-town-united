/** Feature keys gated by a club's plan_tier. Kept to exactly the features that actually have a
 *  real call site — no speculative stub entries for features nobody gates yet. */
export type PlanFeature = "camera" | "largeTournaments";

/** `free_locked` (H-Town, permanently exempt) and `paid` get everything; `trial` (the default for
 *  a newly self-created club) is gated on the 2 features above until a real subscription exists.
 *  `plan_tier` is optional/possibly-unknown (see ClubBrandingContext's own doc comment on why) —
 *  treated as the safe default (gated), never as "assume paid". */
export function clubHasFeature(planTier: string | undefined, feature: PlanFeature): boolean {
  if (planTier === "free_locked" || planTier === "paid") return true;
  return false;
}
