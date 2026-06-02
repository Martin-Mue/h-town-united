-- Games: authenticated only
DROP POLICY IF EXISTS "Users can insert their own games" ON public.games;
DROP POLICY IF EXISTS "Users can delete their own games" ON public.games;

CREATE POLICY "Users can insert their own games"
  ON public.games FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own games"
  ON public.games FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Tournaments: authenticated only
DROP POLICY IF EXISTS "Users can insert their own tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Users can update their own tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Users can delete their own tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Users can view their own tournaments" ON public.tournaments;

CREATE POLICY "Users can insert their own tournaments"
  ON public.tournaments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tournaments"
  ON public.tournaments FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tournaments"
  ON public.tournaments FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own tournaments"
  ON public.tournaments FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Storage: scope avatar write access to file owner (path = {playerId}/...)
DROP POLICY IF EXISTS "Authenticated users can upload avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete avatars" ON storage.objects;

CREATE POLICY "Owners can upload their avatars"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'player-avatars'
    AND EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can update their avatars"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'player-avatars'
    AND EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'player-avatars'
    AND EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can delete their avatars"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'player-avatars'
    AND EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.user_id = auth.uid()
    )
  );

-- Revoke EXECUTE on SECURITY DEFINER functions from anon
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_role() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.club_leaderboard() FROM anon;
REVOKE EXECUTE ON FUNCTION public.club_head_to_head(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_role(uuid, public.app_role, boolean) FROM anon;