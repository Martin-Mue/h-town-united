-- Phase 1 of club branding: a single-row `clubs` table making the (currently hardcoded)
-- H-Town United branding admin-editable, plus a public storage bucket for the club logo.
-- Deliberately NOT a multi-tenant schema yet -- no club_id on players/games/tournaments/etc.,
-- no signup/invite flow changes. Single row by the same convention as `impressum`
-- (20260819230000_add_impressum.sql): the app always reads/writes the first (only) row.
--
-- Unlike impressum, this table must also be readable by fully anonymous visitors -- both
-- /auth (login screen, no session yet) and /live/:slug (public tournament view) render the
-- club's name/logo/theme before or without any authentication. Hence `to anon, authenticated`
-- on the SELECT policy, mirroring the tournaments/tournaments_public precedent
-- (20260711200959, 20260712123435).
--
-- No new SECURITY DEFINER function is introduced here -- reuses the existing, already-hardened
-- public.has_role(uuid, app_role) as-is (verified live: has_role(_user_id uuid, _role app_role),
-- prosecdef=true), so none of the "verify live function body before CREATE OR REPLACE" risk
-- applies to this migration.

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tagline text,
  logo_path text,
  theme_preset text not null default 'default',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clubs enable row level security;

create policy "Anyone can view club branding"
  on public.clubs for select
  to anon, authenticated
  using (true);

-- Only an admin may edit. No public/anon INSERT or DELETE policy at all -- this migration
-- seeds the single row itself; the app never creates or removes clubs rows in Phase 1.
create policy "Admins can update club branding"
  on public.clubs for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

grant select on public.clubs to anon, authenticated;
grant update on public.clubs to authenticated;

create trigger update_clubs_updated_at
  before update on public.clubs
  for each row
  execute function public.update_updated_at_column();

-- Seed row: today's exact H-Town United values. logo_path stays NULL -- the app falls back to
-- the bundled htu-logo.jpg import whenever it's null, so this ships pixel-identical to today
-- until an admin deliberately uploads a logo from Settings.
insert into public.clubs (name, tagline, logo_path, theme_preset)
values ('H-Town United e.V.', 'Von Heiligenhausern, für Heiligenhaus', null, 'default');

-- Public bucket (deliberate exception to the "everything private" pattern used by
-- player-avatars/dart-clips/dart-training) -- the logo must be visible to anonymous
-- /live/:slug viewers. file_size_limit and allowed_mime_types set at creation, unlike the
-- 3 existing buckets, none of which set either.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-logos', 'club-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "Club logos are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'club-logos');

-- Write access admin-gated via has_role, same convention as dart-training's admin-only
-- policies. No path-prefix ownership check like dart-clips/player-avatars use -- there is
-- exactly one club and one global admin role in Phase 1, so there's no "whose folder is this"
-- question yet. A future multi-club phase will need a path-prefix-matches-club-id check.
create policy "Admins can upload club logos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'club-logos' and public.has_role(auth.uid(), 'admin'));

create policy "Admins can update club logos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'club-logos' and public.has_role(auth.uid(), 'admin'));

create policy "Admins can delete club logos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'club-logos' and public.has_role(auth.uid(), 'admin'));
