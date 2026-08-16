-- Adds camera-geometry metadata to training_samples so the accumulated set can later be
-- evaluated/stratified by zoom level and camera angle — without this there's no way to tell
-- whether the set has real variance across setups or is quietly overfit to whichever angle/zoom
-- happened to be used most. Both columns are nullable: existing rows genuinely have no known
-- value here (collected before this migration), and a null is the honest representation of
-- that — not a guessed default.
ALTER TABLE public.training_samples
  ADD COLUMN camera_zoom NUMERIC,
  ADD COLUMN calib_taps JSONB;

COMMENT ON COLUMN public.training_samples.camera_zoom IS
  'Hardware camera zoom factor active at capture time (see calib.zoom in LiveCamera.tsx).';
COMMENT ON COLUMN public.training_samples.calib_taps IS
  'The 4 calibration tap points active at capture time (D20/D3/D11/D6, video-frame-relative x/y, see calib.taps in LiveCamera.tsx) — lets camera angle/rotation be reconstructed later.';
