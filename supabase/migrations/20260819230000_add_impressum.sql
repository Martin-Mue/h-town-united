-- Editable Impressum content (§5 TMG) — was a hardcoded placeholder template in Settings.tsx,
-- now a real single-row table an admin can edit from the app instead of needing a code change.
-- Single row by convention (the app always reads/writes the first row) rather than a formal
-- singleton constraint — there's no multi-tenant concept here, one club, one Impressum.
create table public.impressum (
  id uuid primary key default gen_random_uuid(),
  club_name text not null default '',
  address text not null default '',
  city text not null default '',
  represented_by text not null default '',
  email text not null default '',
  phone text not null default '',
  register_info text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.impressum (club_name) values ('');

alter table public.impressum enable row level security;

create policy "Members can view impressum"
  on public.impressum for select
  to authenticated
  using (true);

-- Legal/official content — only an admin may edit it, same has_role() gate admin_set_role etc.
-- already use, not the general "any member" convention most club data has.
create policy "Admins can update impressum"
  on public.impressum for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
