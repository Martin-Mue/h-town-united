-- "Any authenticated user can upload files into other users' clip storage paths" — the dart-clips
-- INSERT policy only ever checked bucket_id, never the object path, while SELECT/DELETE on this
-- same bucket are already scoped to `owner = auth.uid()` (see 20260816090000_security_advisor_
-- fixes.sql). Actual exploitable impact was limited (Storage always sets `owner` to the real
-- uploader regardless of chosen path, and highlight_clips rows are independently owner-scoped
-- too, so this couldn't be used to impersonate or read another member's clip) — but it did allow
-- uninvited uploads/storage-quota abuse under a path that merely *looks* like another user's
-- folder. The app always uploads to `${auth.uid()}/...` already (see uploadHighlightClip in
-- Game.tsx), so requiring that here costs the app nothing.

DROP POLICY IF EXISTS "Authenticated users can upload dart clips" ON storage.objects;
CREATE POLICY "Users can upload dart clips into their own path"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'dart-clips' AND (storage.foldername(name))[1] = auth.uid()::text);
