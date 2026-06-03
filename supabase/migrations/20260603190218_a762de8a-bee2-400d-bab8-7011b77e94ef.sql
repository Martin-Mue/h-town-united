
-- Fix avatar storage policies: reference storage.objects.name, not the players.name column
DROP POLICY IF EXISTS "Owners can upload their avatars" ON storage.objects;
DROP POLICY IF EXISTS "Owners can update their avatars" ON storage.objects;
DROP POLICY IF EXISTS "Owners can delete their avatars" ON storage.objects;

CREATE POLICY "Owners can upload their avatars" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'player-avatars'
  AND EXISTS (
    SELECT 1 FROM public.players p
    WHERE (p.id)::text = (storage.foldername(storage.objects.name))[1]
      AND p.user_id = auth.uid()
  )
);

CREATE POLICY "Owners can update their avatars" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'player-avatars'
  AND EXISTS (
    SELECT 1 FROM public.players p
    WHERE (p.id)::text = (storage.foldername(storage.objects.name))[1]
      AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'player-avatars'
  AND EXISTS (
    SELECT 1 FROM public.players p
    WHERE (p.id)::text = (storage.foldername(storage.objects.name))[1]
      AND p.user_id = auth.uid()
  )
);

CREATE POLICY "Owners can delete their avatars" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'player-avatars'
  AND EXISTS (
    SELECT 1 FROM public.players p
    WHERE (p.id)::text = (storage.foldername(storage.objects.name))[1]
      AND p.user_id = auth.uid()
  )
);

-- Allow all authenticated club members to view tournaments (mirrors how games are shared club-wide)
DROP POLICY IF EXISTS "Users can view their own tournaments" ON public.tournaments;
CREATE POLICY "Authenticated members can view tournaments" ON public.tournaments
FOR SELECT TO authenticated
USING (true);
