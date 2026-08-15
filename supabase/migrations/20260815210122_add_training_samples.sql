-- Storage + labels for a self-building dart-detection training set. Every local-mode scan
-- already captures a matched "empty board" / "darts stuck in" image pair (see dartVision.ts),
-- and every manual correction the player makes in the round-review UI is a real, free label for
-- that pair. When a player has this opt-in toggle on (see LiveCamera.tsx's TRAINING_DATA_KEY),
-- committing a round uploads the pair plus the final (possibly corrected) dart positions here —
-- so a labeled dataset for a real future on-device model accumulates from normal club play.
CREATE TABLE public.training_samples (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  board TEXT NOT NULL DEFAULT '1',
  before_path TEXT NOT NULL,
  after_path TEXT NOT NULL,
  image_size INTEGER NOT NULL DEFAULT 420,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.training_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can contribute training samples"
  ON public.training_samples FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Read/delete restricted to admins: this is raw camera-captured data, not club content, so
-- regular members shouldn't be able to browse or wipe it even though they can contribute to it.
CREATE POLICY "Admins can view training samples"
  ON public.training_samples FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete training samples"
  ON public.training_samples FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_training_samples_created_at ON public.training_samples(created_at DESC);
CREATE INDEX idx_training_samples_board ON public.training_samples(board);

-- Private bucket (unlike dart-clips) — these are raw board-camera captures. The analysis crop
-- is board-only (see drawToCanvas's circular clip in LiveCamera.tsx), not the wider room, but
-- keeping it non-public and admin-read-only is the safer default for camera-derived data.
INSERT INTO storage.buckets (id, name, public)
VALUES ('dart-training', 'dart-training', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload training images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'dart-training');

CREATE POLICY "Admins can read training images"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'dart-training' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete training images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'dart-training' AND public.has_role(auth.uid(), 'admin'));
