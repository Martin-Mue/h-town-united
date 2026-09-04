-- Optional comment a challenged player can attach when declining an online-match challenge
-- (see online_matches' existing column-grant pattern from its own migration — only status was
-- client-writable before, this adds decline_reason to that same allowlist).
alter table public.online_matches add column decline_reason text;

grant update (status, decline_reason) on public.online_matches to authenticated;
