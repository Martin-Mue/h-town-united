-- Applied live via the Lovable agent right after 20260903110000, mirrored here to keep the repo
-- in sync: restrict_club_billing_edits() is trigger-only (Postgres already calls it regardless
-- of EXECUTE grants when firing the trigger), so it never needed to be directly callable via the
-- API surface — revoking it here matches the same pattern already used for genuinely
-- RPC-only functions elsewhere in this schema (e.g. current_club_id()'s own revoke/grant pair).
revoke execute on function public.restrict_club_billing_edits() from anon, authenticated;
