-- Explicit organizer override for the live view's pre-start gate: hasStarted(t) (first real
-- match decided) already lifts the gate automatically — this lets an organizer release earlier
-- than that on purpose (e.g. before the first throw), independent of match results.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS manual_release boolean NOT NULL DEFAULT false;
