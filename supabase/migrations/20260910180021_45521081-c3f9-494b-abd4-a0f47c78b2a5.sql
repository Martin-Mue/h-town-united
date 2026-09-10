alter table public.online_matches add column if not exists double_in boolean not null default false;
alter table public.online_matches add column if not exists double_out boolean not null default true;
alter table public.online_matches add column if not exists custom_start_score integer;
alter table public.online_matches add column if not exists starter text not null default 'challenger';
alter table public.online_matches drop constraint if exists online_matches_starter_check;
alter table public.online_matches add constraint online_matches_starter_check check (starter in ('challenger', 'opponent', 'random'));
alter table public.online_matches drop constraint if exists online_matches_mode_check;
alter table public.online_matches add constraint online_matches_mode_check check (mode in ('501', '301', 'cricket', 'custom'));