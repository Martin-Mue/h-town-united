-- pushLiveSnapshot (tournamentMatchSync.ts) fires every ~1.2s per active tournament-linked live
-- game, previously as a plain client-side SELECT bracket, patch one match's `live` field locally,
-- UPDATE the whole bracket back. Any other write to the same tournament row landing inside that
-- read-modify-write window (an owner's manual edit, another board's game finishing via
-- recordMatchResult) was silently discarded — the periodic snapshot push would win and revert it.
-- With several boards live at once this collision window isn't theoretical.
--
-- This function does the find-and-patch server-side in a single atomic UPDATE statement instead —
-- no separate SELECT, so no window for another write to land in between. Runs as the caller
-- (SECURITY INVOKER, the default) since the existing "authenticated users can update
-- bracket/champion/status" policy already covers this — no elevated privileges needed.
CREATE OR REPLACE FUNCTION public.update_match_live_snapshot(p_tournament_id uuid, p_match_id text, p_snapshot jsonb)
RETURNS void
LANGUAGE sql
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

REVOKE ALL ON FUNCTION public.update_match_live_snapshot(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_match_live_snapshot(uuid, text, jsonb) TO authenticated;
