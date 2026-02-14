
-- Add user_id to players table
ALTER TABLE public.players ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop old permissive policies
DROP POLICY IF EXISTS "Players are publicly readable" ON public.players;
DROP POLICY IF EXISTS "Players can be inserted by anyone" ON public.players;
DROP POLICY IF EXISTS "Players can be updated by anyone" ON public.players;
DROP POLICY IF EXISTS "Players can be deleted by anyone" ON public.players;

-- New authenticated-only policies
CREATE POLICY "Authenticated users can read players"
  ON public.players FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert players"
  ON public.players FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own players"
  ON public.players FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own players"
  ON public.players FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Update existing players to have no user_id (they'll need to be claimed)
-- This is fine since user_id is nullable

-- Fix storage policies
DROP POLICY IF EXISTS "Anyone can upload player avatars" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update player avatars" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete player avatars" ON storage.objects;

CREATE POLICY "Authenticated users can upload avatars"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'player-avatars');

CREATE POLICY "Authenticated users can update avatars"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'player-avatars');

CREATE POLICY "Authenticated users can delete avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'player-avatars');
