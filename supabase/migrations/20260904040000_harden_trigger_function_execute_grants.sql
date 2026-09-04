-- Security-advisor triage 2026-09-04: 4 trigger functions showed up as EXECUTE-granted to
-- anon/authenticated, which they never need (only ever invoked automatically by their own
-- table's trigger, not called directly by client code) -- restrict_club_billing_edits was
-- already revoked once this session (20260903110001), but a later CREATE OR REPLACE (Lovable's
-- own auto-generated migration mirroring the same billing-column work) reset it. Low real risk
-- either way -- calling one of these directly just errors, since NEW/OLD are only populated
-- inside a real trigger invocation -- but tightening the grant to match actual need.
--
-- Must revoke from PUBLIC, not just anon/authenticated directly -- both roles inherit EXECUTE
-- through the implicit PUBLIC grant every new function gets by default, so revoking only the
-- named roles is a no-op as long as PUBLIC still has it (confirmed live: the first attempt at
-- this revoke, naming anon/authenticated only, left has_function_privilege('anon', ..., 'execute')
-- still true). Same class of bug as the clubs billing-column table-grant issue from earlier this
-- session, just via role inheritance instead of a table-level GRANT.
revoke execute on function public.restrict_club_billing_edits() from public;
revoke execute on function public.restrict_club_plan_tier_edits() from public;
revoke execute on function public.restrict_player_profile_edits_to_owner() from public;
revoke execute on function public.restrict_tournament_edits_to_owner() from public;

-- apply_game_player_stats's own internal check (participant of the game, via auth.uid()) already
-- makes an anonymous call fail every time (auth.uid() is null, so the EXISTS check can never
-- match) -- but the anon EXECUTE grant itself was still broader than needed. authenticated keeps
-- it since every real call site runs as a logged-in user's own session.
revoke execute on function public.apply_game_player_stats(uuid) from public;
grant execute on function public.apply_game_player_stats(uuid) to authenticated;
