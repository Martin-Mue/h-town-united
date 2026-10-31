-- Pilot-Stufe: ein Verein bekommt für einen begrenzten Zeitraum den vollen Funktionsumfang (Kamera,
-- große Turniere, KI-Kommentar, Autodarts). Läuft pilot_until ab, gilt er in der App wieder als "trial"
-- (die App wertet das Datum aus; die Zeile selbst bleibt auf 'pilot', bis der Betreiber sie zurücksetzt).
--
-- plan_tier bleibt für die App unveränderbar (Trigger). Der Betreiber ändert es nur über set_club_pilot /
-- end_club_pilot, die intern die Sperre für genau diesen einen Schreibzugriff öffnen.

alter table public.clubs drop constraint if exists clubs_plan_tier_check;
alter table public.clubs add constraint clubs_plan_tier_check check (plan_tier in ('trial', 'free_locked', 'paid', 'pilot'));
alter table public.clubs add column if not exists pilot_until date;
comment on column public.clubs.pilot_until is
  'Ende des Pilotzeitraums (letzter voller Tag), nur mit plan_tier = pilot. Gesetzt über set_club_pilot().';

create or replace function public.restrict_club_plan_tier_edits() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (NEW.plan_tier is distinct from OLD.plan_tier or NEW.pilot_until is distinct from OLD.pilot_until)
     and auth.uid() is not null
     and coalesce(current_setting('darts.plan_admin', true), '') <> 'on' then
    raise exception 'plan_tier kann nicht über die App geändert werden.';
  end if;
  return NEW;
end; $$;

-- Pilot starten oder verlängern. Nur für Vereine auf trial/pilot (bezahlte und dauerhaft freie bleiben unberührt).
create or replace function public.set_club_pilot(_club uuid, _until date) returns void
language plpgsql security definer set search_path = public as $$
declare v_tier text;
begin
  if not public.is_platform_owner() then raise exception 'Platform owner only'; end if;
  if _until is null or _until <= current_date or _until > current_date + 366 then
    raise exception 'Enddatum muss in der Zukunft und höchstens ein Jahr entfernt liegen.';
  end if;
  select plan_tier into v_tier from public.clubs where id = _club;
  if v_tier is null then raise exception 'Verein nicht gefunden.'; end if;
  if v_tier not in ('trial', 'pilot') then
    raise exception 'Dieser Verein hat bereits den Plan "%". Pilot nur für Trial-Vereine.', v_tier;
  end if;
  perform set_config('darts.plan_admin', 'on', true);
  update public.clubs set plan_tier = 'pilot', pilot_until = _until where id = _club;
end; $$;

-- Pilot beenden: zurück auf trial.
create or replace function public.end_club_pilot(_club uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_owner() then raise exception 'Platform owner only'; end if;
  perform set_config('darts.plan_admin', 'on', true);
  update public.clubs set plan_tier = 'trial', pilot_until = null where id = _club and plan_tier = 'pilot';
end; $$;

-- Übersicht aller Vereine für den Betreiber.
create or replace function public.platform_clubs()
returns table (id uuid, name text, plan_tier text, pilot_until date, members bigint, players bigint, active_7d bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_owner() then raise exception 'Platform owner only'; end if;
  return query
    select c.id, c.name, c.plan_tier, c.pilot_until,
      (select count(*) from public.user_roles r where r.club_id = c.id and r.role = 'member'),
      (select count(*) from public.players p where p.club_id = c.id),
      coalesce((select sum(d.events) from public.usage_daily d where d.club_id = c.id and d.feature = '_dau' and d.day >= current_date - 7), 0)::bigint,
      c.created_at
    from public.clubs c order by c.created_at;
end; $$;

revoke all on function public.set_club_pilot(uuid, date) from public, anon;
revoke all on function public.end_club_pilot(uuid) from public, anon;
revoke all on function public.platform_clubs() from public, anon;
grant execute on function public.set_club_pilot(uuid, date) to authenticated;
grant execute on function public.end_club_pilot(uuid) to authenticated;
grant execute on function public.platform_clubs() to authenticated;
