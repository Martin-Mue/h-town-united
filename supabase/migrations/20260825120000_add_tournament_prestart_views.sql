-- Lets the live view (PublicTournament.tsx) know which pages should stay visible before a
-- tournament's first real match has a result (see 20260825120100/20260825120200 for the read/
-- write-protection side of this). Defaults to the same set the app itself defaults to when this
-- column is null/empty for an older tournament (see DEFAULT_PRESTART_VIEWS in
-- src/utils/tournament.ts) — kept in sync deliberately, not load-bearing on its own since the
-- frontend already falls back to that same default.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS prestart_views jsonb NOT NULL DEFAULT '["waiting","format","qr"]'::jsonb;
