alter table public.games add column if not exists ai_report text;
comment on column public.games.ai_report is
  'AI-generated post-match recap (KI-Spielbericht), written by the generate-match-report edge function via the service role. Null until a player opts in.';