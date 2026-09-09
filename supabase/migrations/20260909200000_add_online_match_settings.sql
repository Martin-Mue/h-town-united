-- "mehr Einstellungen für Online-Spiele" — casual 1v1 challenges (OnlineChallengeSetup.tsx)
-- previously only let you pick mode (501/301/cricket) and best-of-legs; everything else was
-- hardcoded at accept-time in PendingOnlineChallenges.tsx's accept() (double_out always true,
-- double_in always false, challenger always starts, no custom start score). This adds columns for
-- three new match-level (not per-player) settings: double-in/out, a custom X01 start score
-- (mirrors Game.tsx's own local "custom" mode — see types/game.ts's GameMode), and who starts.
-- Per-player handicap and per-player (as opposed to shared) double-in/out remain local-only —
-- explicitly out of scope for this round.
--
-- if-not-exists per this project's established convention (see 20260909182000's own comment) since
-- the Lovable editor can apply a migration to the live DB before its matching file lands here.
alter table public.online_matches
  add column if not exists double_in boolean not null default false,
  add column if not exists double_out boolean not null default true,
  add column if not exists custom_start_score integer,
  add column if not exists starter text not null default 'challenger' check (starter in ('challenger', 'opponent', 'random'));

-- 'custom' joins the existing mode enum (mirrors GameMode's local "custom") so a challenge can
-- carry a custom_start_score. Drop-and-recreate is the only way to widen an inline CHECK;
-- "online_matches_mode_check" is Postgres's own default name for the unnamed column-level check
-- declared on `mode` in the original CREATE TABLE (20260903130000_add_online_matches.sql), same
-- convention as online_matches_status_check/online_matches_source_type_check on that same table.
-- Safe to (re)run: drop-if-exists then recreate, so it converges to the same end state either way.
alter table public.online_matches drop constraint if exists online_matches_mode_check;
alter table public.online_matches add constraint online_matches_mode_check check (mode in ('501', '301', 'cricket', 'custom'));

comment on column public.online_matches.double_in is
  'Double-in required to start scoring, applied to BOTH players (a per-match house rule, not per-player like the local game''s playerDoubleIn) — set by OnlineChallengeSetup.tsx. Defaults to false (straight in), matching the pre-existing hardcoded behavior for any row/client that predates this column.';
comment on column public.online_matches.double_out is
  'Double-out required to finish a leg, applied to BOTH players. Defaults to true, matching the pre-existing hardcoded behavior.';
comment on column public.online_matches.custom_start_score is
  'X01 start score when mode = ''custom'' (e.g. 701, 170), set by OnlineChallengeSetup.tsx. Null/ignored for every other mode.';
comment on column public.online_matches.starter is
  'Who starts leg 1: ''challenger'' (player1 — the pre-existing hardcoded default), ''opponent'' (player2, the accepter), or ''random'' (coin flip resolved client-side by PendingOnlineChallenges.tsx''s accept() at accept-time, the first moment both players are represented).';

-- No RLS policy changes needed: the existing "Club members can create online match challenges"
-- INSERT policy already covers every column on the row the same way (see
-- 20260903130000_add_online_matches.sql's own comment on why INSERT is unrestricted per-column
-- while UPDATE is deliberately narrowed to just `status`).
