-- highlight_clips SELECT has been owner-only since its very first migration
-- (20260811172300_add_highlight_clips.sql), even though Statistics.tsx's "highlights" tab
-- fetches unfiltered (`select("*")`) expecting club-wide visibility — same pattern as
-- games/game_legs/manual_180_entries/tournament_series, all deliberately opened club-wide
-- because this is a shared club app, not a personal tracker (see
-- 20260818200000_fix_cross_player_stat_updates_and_leg_visibility.sql for the same fix applied
-- to game_legs). Net effect until now: the club-scope highlights tab has likely only ever shown
-- the viewer's own clips.
--
-- The dart-clips STORAGE bucket's SELECT policy is included here too, not left owner-scoped —
-- opening the highlight_clips ROW alone without this would show the clip's card (player, kind,
-- points) club-wide while its `createSignedUrl` call keeps failing for everyone but the
-- uploader, since that call is subject to the bucket's own RLS. This is a different concern from
-- 20260816090000_security_advisor_fixes.sql's "bucket flipped private" fix (which was about
-- ANONYMOUS internet access via a guessable public URL) — authenticated club members reading
-- each other's clips is the same already-accepted trust model as every other club-wide table
-- here, and matches how the player-avatars bucket already allows any authenticated member to
-- view (not just the owner).

DROP POLICY IF EXISTS "Users can view their own highlight clips" ON public.highlight_clips;
CREATE POLICY "Authenticated members can view all club highlight clips"
  ON public.highlight_clips FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can view their own dart clips" ON storage.objects;
CREATE POLICY "Authenticated members can view all club dart clips"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'dart-clips');
