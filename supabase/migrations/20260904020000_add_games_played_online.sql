-- Distinguishes an online (two-device, synced via online_matches) game from a local one, so
-- Statistics.tsx can show an online-vs-local breakdown per the user's request. games itself has
-- no other reference back to online_matches (that row is ephemeral/reusable state, not a
-- permanent record) -- a plain boolean is all this needs, no FK.
alter table public.games add column played_online boolean not null default false;
