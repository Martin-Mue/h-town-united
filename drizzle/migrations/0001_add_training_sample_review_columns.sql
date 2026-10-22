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