-- Training records, attempt history and the practice streak used to live only in one browser: a new phone, another
-- browser or cleared site data lost them. They are now kept per account as well. The app keeps its fast local copy and
-- mirrors every change here; on sign-in both are merged (see src/lib/trainingProgressMerge.ts).

CREATE TABLE IF NOT EXISTS public.training_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- the local storage key: "training-record-<drill>[:variant]", "training-history-<drill>[:variant]", "training-streak"
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key),
  CONSTRAINT training_progress_key_shape CHECK (key ~ '^training-(record-|history-|streak$)' AND length(key) <= 200)
);

ALTER TABLE public.training_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own training progress: read" ON public.training_progress;
CREATE POLICY "own training progress: read" ON public.training_progress
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own training progress: insert" ON public.training_progress;
CREATE POLICY "own training progress: insert" ON public.training_progress
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own training progress: update" ON public.training_progress;
CREATE POLICY "own training progress: update" ON public.training_progress
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own training progress: delete" ON public.training_progress;
CREATE POLICY "own training progress: delete" ON public.training_progress
  FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.training_progress FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_progress TO authenticated;
