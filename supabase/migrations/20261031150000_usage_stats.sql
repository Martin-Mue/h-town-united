-- Anonyme Nutzungsstatistik: welche Bereiche werden wie oft genutzt, wie viele Mitglieder sind aktiv,
-- wie viele kommen innerhalb einer Woche wieder. Ohne Drittanbieter, ohne Namen, ohne Geräte-ID.
--
-- Datensparsamkeit by design:
--  * usage_daily   - nur Zähler je Verein/Tag/Funktion. Kein Bezug zu einer Person.
--  * usage_active  - wer war heute aktiv, nur als Hash. Der Hash ist mit einem geheimen Serverwert UND dem
--                    Wochenanfang gesalzen: über Wochen hinweg nicht verknüpfbar, ohne Serverwert nicht
--                    zurückrechenbar. Zeilen werden nach spätestens 3 Wochen gelöscht.
--  * usage_weekly  - Wochen-Rollup (aktive Nutzer, "Wiederkehrer" mit >= 2 aktiven Tagen), nur Zahlen.
-- Niemand außer den Server-Funktionen kann diese Tabellen lesen (RLS an, keine Policy, alle Rechte entzogen);
-- Die Auswertung sieht nur der Plattform-Betreiber (usage_overview, siehe platform_owners).

create table if not exists public.usage_daily (
  day date not null,
  club_id uuid not null references public.clubs(id) on delete cascade,
  feature text not null,
  events int not null default 0,
  primary key (day, club_id, feature)
);

create table if not exists public.usage_active (
  day date not null,
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_hash text not null,
  primary key (day, club_id, user_hash)
);

create table if not exists public.usage_weekly (
  week_start date not null,
  club_id uuid not null references public.clubs(id) on delete cascade,
  active_users int not null,
  repeat_users int not null,
  primary key (week_start, club_id)
);

create table if not exists public.usage_secret (
  id boolean primary key default true check (id),
  secret text not null default (gen_random_uuid()::text || gen_random_uuid()::text)
);
insert into public.usage_secret default values on conflict do nothing;

alter table public.usage_daily enable row level security;
alter table public.usage_active enable row level security;
alter table public.usage_weekly enable row level security;
alter table public.usage_secret enable row level security;
revoke all on public.usage_daily, public.usage_active, public.usage_weekly, public.usage_secret from anon, authenticated;

-- Wochen-Rollup + Löschen vollständig abgeschlossener Wochen, die älter als zwei Wochen sind.
create or replace function public.usage_housekeeping() returns void
language plpgsql security definer set search_path = public as $$
declare v_cut date := (date_trunc('week', current_date) - interval '14 days')::date;
begin
  insert into public.usage_weekly (week_start, club_id, active_users, repeat_users)
  select w, club_id, count(*), count(*) filter (where d >= 2)
  from (
    select date_trunc('week', day)::date as w, club_id, user_hash, count(*) as d
    from public.usage_active where day < v_cut group by 1, 2, 3
  ) x group by w, club_id
  on conflict (week_start, club_id) do update
    set active_users = excluded.active_users, repeat_users = excluded.repeat_users;
  delete from public.usage_active where day < v_cut;
  delete from public.usage_daily where day < current_date - 400;
end; $$;
revoke all on function public.usage_housekeeping() from public, anon, authenticated;

-- Ein Ereignis zählen. Fehler nie nach außen: Messung darf die App nie stören.
create or replace function public.track_usage(_feature text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_club uuid := public.current_club_id();
  v_me uuid := auth.uid();
  v_week date := date_trunc('week', current_date)::date;
  v_secret text;
  v_new int;
begin
  if v_me is null or v_club is null then return; end if;
  if _feature is null or _feature !~ '^[a-z0-9_:-]{1,40}$' then return; end if;
  -- höchstens 80 verschiedene Funktionsnamen je Verein und Tag (schützt vor Müll-Einträgen)
  if not exists (select 1 from public.usage_daily where day = current_date and club_id = v_club and feature = _feature)
     and (select count(*) from public.usage_daily where day = current_date and club_id = v_club) >= 80 then
    return;
  end if;
  insert into public.usage_daily (day, club_id, feature, events) values (current_date, v_club, _feature, 1)
    on conflict (day, club_id, feature) do update set events = public.usage_daily.events + 1;
  select secret into v_secret from public.usage_secret;
  insert into public.usage_active (day, club_id, user_hash)
    values (current_date, v_club, md5(v_me::text || v_week::text || v_secret))
    on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new > 0 then
    -- einmal pro aktivem Nutzer und Tag: bleibt als Zahl erhalten, auch wenn usage_active später gelöscht wird
    insert into public.usage_daily (day, club_id, feature, events) values (current_date, v_club, '_dau', 1)
      on conflict (day, club_id, feature) do update set events = public.usage_daily.events + 1;
  end if;
  if random() < 0.02 then perform public.usage_housekeeping(); end if;
exception when others then
  return;
end; $$;
revoke all on function public.track_usage(text) from public, anon;
grant execute on function public.track_usage(text) to authenticated;

-- Plattform-Betreiber: nur diese Konten sehen Analyse-Bereiche (Nutzung, KI-Trainer, Statistiken).
-- Eintragen (einmalig, per SQL): insert into public.platform_owners (user_id) select id from auth.users where email = '<betreiber-mail>';
create table if not exists public.platform_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.platform_owners enable row level security;
revoke all on public.platform_owners from anon, authenticated;

create or replace function public.is_platform_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_owners where user_id = auth.uid());
$$;
revoke all on function public.is_platform_owner() from public, anon;
grant execute on function public.is_platform_owner() to authenticated;

-- Auswertung, nur für Plattform-Betreiber. _club = null -> alle Vereine zusammen.
create or replace function public.usage_overview(_days int default 28, _club uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from date := current_date - greatest(1, least(coalesce(_days, 28), 180));
  v_cut date := (date_trunc('week', current_date) - interval '14 days')::date;
begin
  if not public.is_platform_owner() then
    raise exception 'Platform owner only';
  end if;
  return jsonb_build_object(
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'active', total) order by day)
      from (
        select day, sum(events)::int as total from public.usage_daily
        where feature = '_dau' and day >= v_from and (_club is null or club_id = _club) group by day
      ) d
    ), '[]'::jsonb),
    'features', coalesce((
      select jsonb_agg(jsonb_build_object('feature', feature, 'events', total, 'days', days) order by total desc)
      from (
        select feature, sum(events)::int as total, count(distinct day)::int as days
        from public.usage_daily
        where feature <> '_dau' and day >= v_from and (_club is null or club_id = _club) group by feature
      ) f
    ), '[]'::jsonb),
    'weekly', coalesce((
      select jsonb_agg(jsonb_build_object('week', w, 'active', a, 'repeat', r) order by w)
      from (
        select week_start as w, sum(active_users)::int as a, sum(repeat_users)::int as r
        from public.usage_weekly where week_start >= v_from - 7 and (_club is null or club_id = _club) group by week_start
        union all
        select w, count(*)::int, count(*) filter (where d >= 2)::int
        from (
          select date_trunc('week', day)::date as w, club_id, user_hash, count(*) as d
          from public.usage_active where day >= v_cut and (_club is null or club_id = _club) group by 1, 2, 3
        ) live group by w
      ) u
    ), '[]'::jsonb),
    'clubs', coalesce((
      select jsonb_agg(jsonb_build_object('club', c.name, 'active', t.total) order by t.total desc)
      from (select club_id, sum(events)::int as total from public.usage_daily
            where feature = '_dau' and day >= v_from group by club_id) t
      join public.clubs c on c.id = t.club_id
    ), '[]'::jsonb)
  );
end; $$;
revoke all on function public.usage_overview(int, uuid) from public, anon;
grant execute on function public.usage_overview(int, uuid) to authenticated;
