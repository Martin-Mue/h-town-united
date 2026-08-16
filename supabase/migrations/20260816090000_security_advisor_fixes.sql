-- Fixes for issues surfaced by the Supabase/Lovable security advisor.

-- 1. "Function Search Path Mutable" — update_match_live_snapshot was added (2026-08-16, see
--    atomic_live_snapshot_update.sql) without SET search_path, unlike every other function in
--    this schema. A mutable search_path on a function is a known privilege-escalation vector
--    (a malicious schema earlier in the caller's search_path could shadow `jsonb_array_elements`
--    etc.) — low risk here since it's SECURITY INVOKER, not DEFINER, but cheap to close.
CREATE OR REPLACE FUNCTION public.update_match_live_snapshot(p_tournament_id uuid, p_match_id text, p_snapshot jsonb)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.tournaments
  SET bracket = (
    SELECT jsonb_agg(
      CASE WHEN elem->>'id' = p_match_id THEN elem || jsonb_build_object('live', p_snapshot) ELSE elem END
    )
    FROM jsonb_array_elements(bracket) AS elem
  )
  WHERE id = p_tournament_id AND bracket IS NOT NULL;
$$;

-- 2. "Highlight video clips readable by anyone on the internet" — the dart-clips bucket was
--    created `public = true` "for simplicity" (see add_highlight_clips.sql), but nothing in the
--    app actually needs unauthenticated access: Game.tsx only uploads while signed in,
--    Statistics.tsx only plays clips back while signed in, and the highlight_clips TABLE's own
--    RLS already restricts row visibility to the clip's owner — so no one could even discover
--    another member's clip path through the app itself. Flip the bucket private and scope the
--    storage read policy to the object's owner; the app switches to short-lived signed URLs
--    (see Statistics.tsx's clipSignedUrls).
UPDATE storage.buckets SET public = false WHERE id = 'dart-clips';

DROP POLICY IF EXISTS "Dart clips are publicly accessible" ON storage.objects;
CREATE POLICY "Users can view their own dart clips"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'dart-clips' AND owner = auth.uid());

-- 3. "Any logged-in user can modify any tournament" (critical) — the owner-lock trigger added
--    2026-08-15 deliberately left bracket/champion/status open to EVERY authenticated user (not
--    just the owner), because a live game's automatic result write-back and manual scorekeeper
--    entry both need to work no matter whose account is doing it — scorekeepers are drawn from
--    the tournament's own player list, not just its owner (see assignScorekeepers). That's still
--    the right shape, but "every authenticated user in the whole app" was far wider than
--    intended: it let any account tamper with a tournament it has nothing to do with. Narrow it
--    to accounts with a linked player profile actually named in THIS tournament's `players`
--    roster — covers both players of a match and anyone assigned as scorekeeper, without
--    touching the tournament owner's already-unrestricted access.
CREATE OR REPLACE FUNCTION public.restrict_tournament_edits_to_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.mode IS DISTINCT FROM OLD.mode
      OR NEW.game_mode IS DISTINCT FROM OLD.game_mode
      OR NEW.best_of_legs IS DISTINCT FROM OLD.best_of_legs
      OR NEW.players IS DISTINCT FROM OLD.players
      OR NEW.series_id IS DISTINCT FROM OLD.series_id
      OR NEW.round_configs IS DISTINCT FROM OLD.round_configs
      OR NEW.max_rounds_x01 IS DISTINCT FROM OLD.max_rounds_x01
      OR NEW.public_view IS DISTINCT FROM OLD.public_view
      OR NEW.public_slug IS DISTINCT FROM OLD.public_slug
      OR NEW.boards IS DISTINCT FROM OLD.boards
      OR NEW.live_play_enabled IS DISTINCT FROM OLD.live_play_enabled
    THEN
      RAISE EXCEPTION 'Nur der Ersteller darf die Turniereinstellungen ändern.';
    END IF;
    IF (NEW.bracket IS DISTINCT FROM OLD.bracket
        OR NEW.champion IS DISTINCT FROM OLD.champion
        OR NEW.status IS DISTINCT FROM OLD.status)
      AND NOT EXISTS (
        SELECT 1 FROM public.players p
        WHERE p.user_id = auth.uid()
          AND p.name IN (SELECT jsonb_array_elements_text(OLD.players))
      )
    THEN
      RAISE EXCEPTION 'Nur Teilnehmer oder zugewiesene Schreiber dieses Turniers dürfen den Spielstand aktualisieren.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
