-- New club-wide 'editor' role — see 20260903100001_fix_tournament_lock_regression_and_editor_bypass.sql
-- for what it actually unlocks. Kept in its OWN migration file/transaction: Postgres forbids
-- referencing a freshly-added enum value in the same transaction that added it, so anything that
-- uses 'editor' (the has_role() calls in the next migration) must live in a later file.
alter type public.app_role add value 'editor';
