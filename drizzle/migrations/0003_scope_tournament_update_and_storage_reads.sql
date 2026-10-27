DROP POLICY IF EXISTS "Authenticated members can update tournaments (see trigger for c" ON public.tournaments;
CREATE POLICY "Club members can update club tournaments" ON public.tournaments FOR UPDATE TO authenticated
USING (club_id = public.current_club_id()) WITH CHECK (club_id = public.current_club_id());

DROP POLICY IF EXISTS "Authenticated members can view all club dart clips" ON storage.objects;
CREATE POLICY "Club members can view club dart clips" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'dart-clips' AND (
  (storage.foldername(name))[1] = auth.uid()::text
  OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id::text = (storage.foldername(name))[1] AND ur.club_id = public.current_club_id())
));

DROP POLICY IF EXISTS "Authenticated users can upload training images" ON storage.objects;
CREATE POLICY "Users can upload training images into own folder" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'dart-training' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Authenticated users can view avatars" ON storage.objects;
CREATE POLICY "Club members can view club avatars" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'player-avatars' AND EXISTS (
  SELECT 1 FROM public.players p WHERE p.id::text = (storage.foldername(name))[1] AND p.club_id = public.current_club_id()
));