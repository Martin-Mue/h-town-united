-- Redesign 2026-11: "Dartspot" (yellow + dartboard colors) becomes the color theme of NEW clubs.
--
-- Existing clubs are deliberately untouched. They store theme_preset = 'default', and 'default' is
-- the id of the Cyan & Gold preset in src/lib/clubThemePresets.ts (kept for exactly this reason),
-- so H-Town United stays Cyan. Checked 2026-11-12: H-Town United = 'default', Essex arrows =
-- 'default', TestKollersee = 'bordeaux'. No row holds an unknown id, so the app's fallback change
-- (unknown id -> Dartspot) does not affect anyone either.

alter table public.clubs alter column theme_preset set default 'dartspot';

-- Same body as the live function, only the literal preset changes ('default' -> 'dartspot').
-- CREATE OR REPLACE keeps the existing EXECUTE grants.
create or replace function public.create_club(_name text, _tagline text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_club_id uuid;
begin
  if exists (select 1 from public.user_roles where user_id = auth.uid()) then
    raise exception 'Dieser Account gehört bereits zu einem Verein.';
  end if;
  if trim(coalesce(_name, '')) = '' then
    raise exception 'Bitte einen Vereinsnamen angeben.';
  end if;

  insert into public.clubs (name, tagline, theme_preset)
    values (trim(_name), nullif(trim(coalesce(_tagline, '')), ''), 'dartspot')
    returning id into v_club_id;

  insert into public.user_roles (user_id, club_id, role) values (auth.uid(), v_club_id, 'admin');

  insert into public.impressum (club_id, club_name, address, city, represented_by, email, phone, register_info)
    values (v_club_id, '', '', '', '', '', '', '');

  return v_club_id;
end;
$function$;
