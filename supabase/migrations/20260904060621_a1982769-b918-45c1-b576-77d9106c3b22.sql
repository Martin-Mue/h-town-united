alter table public.online_matches add column if not exists decline_reason text;
grant update (status, decline_reason) on public.online_matches to authenticated;