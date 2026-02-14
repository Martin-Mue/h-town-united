
-- Make bucket private
UPDATE storage.buckets SET public = false WHERE id = 'player-avatars';

-- Add authenticated SELECT policy for storage (currently only public read exists)
DROP POLICY IF EXISTS "Player avatars are publicly accessible" ON storage.objects;

CREATE POLICY "Authenticated users can view avatars"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'player-avatars');
