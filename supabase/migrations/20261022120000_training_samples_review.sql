-- Review pipeline for the self-building dart-detection training set: an AI pass (run in batches,
-- see the admin "KI-Trainer" tab) checks every sample's labels against its images, and only
-- samples that end up 'confirmed' should be exported for fine-tuning.
--   pending      - not reviewed yet
--   confirmed    - labels verified (AI agreed with the stored label, or an admin approved it)
--   needs_review - AI disagreed or was unsure; waits for an admin decision
--   rejected     - labels unusable, excluded from training
ALTER TABLE public.training_samples
  ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'confirmed', 'needs_review', 'rejected')),
  ADD COLUMN ai_segments JSONB,
  ADD COLUMN ai_notes TEXT,
  ADD COLUMN reviewed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN reviewed_by TEXT;

CREATE INDEX idx_training_samples_review_status ON public.training_samples(review_status);

CREATE POLICY "Admins can review training samples"
  ON public.training_samples FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
