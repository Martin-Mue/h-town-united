-- restrict_player_profile_edits_to_owner (20260818200000) locks name/nickname/emoji/bio/etc. to
-- "only the owner can change it" — but for a walk-in player created with no linked account
-- (user_id IS NULL), auth.uid() can never equal OLD.user_id, so literally nobody, not even an
-- admin, could ever fix so much as a typo. The only "fix" available in the app was delete +
-- recreate, which (via ON DELETE SET NULL on games.player1_id/player2_id/winner_id) silently
-- nulls that player out of every historical game they'd played. Adds a narrow exception: an admin
-- may edit a profile specifically when it has no linked account. Does not touch the owner-only
-- rule for anyone's actual linked profile, and doesn't add a way to change user_id itself through
-- this path (still one of the checked/blocked fields below, same as before).

CREATE OR REPLACE FUNCTION public.restrict_player_profile_edits_to_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM OLD.user_id
     AND NOT (OLD.user_id IS NULL AND public.has_role(auth.uid(), 'admin'))
  THEN
    IF NEW.name IS DISTINCT FROM OLD.name
      OR NEW.nickname IS DISTINCT FROM OLD.nickname
      OR NEW.emoji IS DISTINCT FROM OLD.emoji
      OR NEW.bio IS DISTINCT FROM OLD.bio
      OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
      OR NEW.ai_portrait_url IS DISTINCT FROM OLD.ai_portrait_url
      OR NEW.throwing_hand IS DISTINCT FROM OLD.throwing_hand
      OR NEW.dart_weight_g IS DISTINCT FROM OLD.dart_weight_g
      OR NEW.favorite_double IS DISTINCT FROM OLD.favorite_double
      OR NEW.hometown IS DISTINCT FROM OLD.hometown
      OR NEW.joined_year IS DISTINCT FROM OLD.joined_year
      OR NEW.motto IS DISTINCT FROM OLD.motto
      OR NEW.birthday IS DISTINCT FROM OLD.birthday
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
    THEN
      RAISE EXCEPTION 'Nur das Mitglied selbst darf sein eigenes Profil bearbeiten.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
