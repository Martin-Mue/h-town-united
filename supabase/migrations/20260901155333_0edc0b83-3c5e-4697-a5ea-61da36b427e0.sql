-- === 1) Trigger-Funktionen um club_id-Schutz ergänzen ===
create or replace function public.restrict_tournament_edits_to_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF auth.uid() IS DISTINCT FROM OLD.user_id THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.club_id IS DISTINCT FROM OLD.club_id
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.mode IS DISTINCT FROM OLD.mode
      OR NEW.game_mode IS DISTINCT FROM OLD.game_mode
      OR NEW.best_of_legs IS DISTINCT FROM OLD.best_of_legs
      OR NEW.players IS DISTINCT FROM OLD.players
      OR NEW.series_id IS DISTINCT FROM OLD.series_id
      OR NEW.round_configs IS DISTINCT FROM OLD.round_configs
      OR NEW.max_rounds_x01 IS DISTINCT FROM OLD.max_rounds_x01
      OR NEW.public_view IS DISTINCT FROM OLD.public_view
      OR NEW.public_slug IS DISTINCT FROM OLD.public_slug
      OR NEW.boards IS DISTINCT FROM OLD.boards
      OR NEW.live_play_enabled IS DISTINCT FROM OLD.live_play_enabled
      OR NEW.attendance IS DISTINCT FROM OLD.attendance
      OR NEW.prestart_views IS DISTINCT FROM OLD.prestart_views
      OR NEW.manual_release IS DISTINCT FROM OLD.manual_release
    THEN
      RAISE EXCEPTION 'Nur der Ersteller darf die Turniereinstellungen ändern.';
    END IF;
    IF (NEW.bracket IS DISTINCT FROM OLD.bracket
        OR NEW.champion IS DISTINCT FROM OLD.champion
        OR NEW.status IS DISTINCT FROM OLD.status)
      AND NOT EXISTS (
        SELECT 1 FROM public.players p
        WHERE p.user_id = auth.uid()
          AND p.name IN (SELECT jsonb_array_elements_text(OLD.players))
      )
    THEN
      RAISE EXCEPTION 'Nur Teilnehmer oder zugewiesene Schreiber dieses Turniers dürfen den Spielstand aktualisieren.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

create or replace function public.restrict_player_profile_edits_to_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF auth.uid() IS DISTINCT FROM OLD.user_id
     AND NOT (OLD.user_id IS NULL AND public.has_role(auth.uid(), 'admin'))
  THEN
    IF NEW.name IS DISTINCT FROM OLD.name
      OR NEW.nickname IS DISTINCT FROM OLD.nickname
      OR NEW.emoji IS DISTINCT FROM OLD.emoji
      OR NEW.bio IS DISTINCT FROM OLD.bio
      OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
      OR NEW.ai_portrait_url IS DISTINCT FROM OLD.ai_portrait_url
      OR NEW.throwing_hand IS DISTINCT FROM OLD.throwing_hand
      OR NEW.dart_weight_g IS DISTINCT FROM OLD.dart_weight_g
      OR NEW.favorite_double IS DISTINCT FROM OLD.favorite_double
      OR NEW.hometown IS DISTINCT FROM OLD.hometown
      OR NEW.joined_year IS DISTINCT FROM OLD.joined_year
      OR NEW.motto IS DISTINCT FROM OLD.motto
      OR NEW.birthday IS DISTINCT FROM OLD.birthday
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.club_id IS DISTINCT FROM OLD.club_id
    THEN
      RAISE EXCEPTION 'Nur das Mitglied selbst darf sein eigenes Profil bearbeiten.';
    END IF;

    IF current_setting('darts.stat_rollup', true) IS DISTINCT FROM 'on' THEN
      IF NEW.games_played IS DISTINCT FROM OLD.games_played
        OR NEW.average IS DISTINCT FROM OLD.average
        OR NEW.high_score IS DISTINCT FROM OLD.high_score
        OR NEW.double_rate IS DISTINCT FROM OLD.double_rate
      THEN
        RAISE EXCEPTION 'Spielstatistiken werden nur automatisch nach einem echten Spiel verbucht.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- === 2) plan_tier ===
alter table public.clubs add column plan_tier text not null default 'trial'
  check (plan_tier in ('trial', 'free_locked', 'paid'));

comment on column public.clubs.plan_tier is
  'Scaffolding for future billing -- no enforcement exists yet. free_locked is permanent and '
  'exclusive to the original club; trial is the default for self-serve-created clubs; paid is '
  'reserved for when real billing exists. Changeable only via direct DB access, see the '
  'restrict_club_plan_tier_edits trigger.';

update public.clubs set plan_tier = 'free_locked' where name = 'H-Town United e.V.';

create or replace function public.restrict_club_plan_tier_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.plan_tier is distinct from OLD.plan_tier and auth.uid() is not null then
    raise exception 'plan_tier kann nicht über die App geändert werden.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists clubs_restrict_plan_tier on public.clubs;
create trigger clubs_restrict_plan_tier
  before update on public.clubs
  for each row execute function public.restrict_club_plan_tier_edits();

create or replace view public.clubs_public as
  select id, name, tagline, logo_path, theme_preset from public.clubs;

grant select on public.clubs_public to anon, authenticated;

drop policy if exists "Anyone can view club branding" on public.clubs;
create policy "Club members can view their own club"
  on public.clubs for select
  to authenticated
  using (id = public.current_club_id());

-- === 3) club-logos Storage: Schreibzugriff auf eigenen Verein ===
drop policy if exists "Admins can upload club logos" on storage.objects;
create policy "Admins can upload club logos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'club-logos'
    and public.has_role(auth.uid(), 'admin')
    and (storage.foldername(name))[1] = public.current_club_id()::text
  );

drop policy if exists "Admins can update club logos" on storage.objects;
create policy "Admins can update club logos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'club-logos'
    and public.has_role(auth.uid(), 'admin')
    and (storage.foldername(name))[1] = public.current_club_id()::text
  )
  with check (
    bucket_id = 'club-logos'
    and public.has_role(auth.uid(), 'admin')
    and (storage.foldername(name))[1] = public.current_club_id()::text
  );

drop policy if exists "Admins can delete club logos" on storage.objects;
create policy "Admins can delete club logos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'club-logos'
    and public.has_role(auth.uid(), 'admin')
    and (storage.foldername(name))[1] = public.current_club_id()::text
  );

-- === 4) SECURITY DEFINER RPCs auf eigenen Verein filtern ===
create or replace function public.club_leaderboard()
 returns TABLE(player_id uuid, player_name text, emoji text, games_played bigint, games_won bigint, avg_score numeric, highscore integer, win_rate numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  WITH per_player AS (
    SELECT
      pl.id AS player_id,
      pl.name AS player_name,
      pl.emoji,
      COUNT(g.*) AS games_played,
      COUNT(*) FILTER (WHERE g.winner_id = pl.id) AS games_won,
      AVG(CASE WHEN g.player1_id = pl.id THEN g.player1_average
               WHEN g.player2_id = pl.id THEN g.player2_average END) AS avg_score,
      MAX(GREATEST(
        CASE WHEN g.player1_id = pl.id THEN g.player1_highscore ELSE 0 END,
        CASE WHEN g.player2_id = pl.id THEN g.player2_highscore ELSE 0 END
      )) AS highscore
    FROM public.players pl
    LEFT JOIN public.games g
      ON (g.player1_id = pl.id OR g.player2_id = pl.id)
     AND g.club_id = public.current_club_id()
    WHERE pl.club_id = public.current_club_id()
    GROUP BY pl.id, pl.name, pl.emoji
  )
  SELECT
    player_id, player_name, emoji,
    games_played, games_won,
    ROUND(COALESCE(avg_score, 0)::numeric, 1),
    COALESCE(highscore, 0)::int,
    CASE WHEN games_played > 0 THEN ROUND((games_won::numeric / games_played) * 100, 1) ELSE 0 END
  FROM per_player
  ORDER BY games_won DESC, avg_score DESC NULLS LAST;
$function$;

create or replace function public.club_head_to_head(_player_a uuid, _player_b uuid)
 returns TABLE(total_games bigint, a_wins bigint, b_wins bigint, a_avg numeric, b_avg numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  SELECT
    COUNT(*) AS total_games,
    COUNT(*) FILTER (WHERE g.winner_id = _player_a) AS a_wins,
    COUNT(*) FILTER (WHERE g.winner_id = _player_b) AS b_wins,
    ROUND(AVG(CASE WHEN g.player1_id = _player_a THEN g.player1_average
                   WHEN g.player2_id = _player_a THEN g.player2_average END)::numeric, 1) AS a_avg,
    ROUND(AVG(CASE WHEN g.player1_id = _player_b THEN g.player1_average
                   WHEN g.player2_id = _player_b THEN g.player2_average END)::numeric, 1) AS b_avg
  FROM public.games g
  WHERE g.club_id = public.current_club_id()
    AND ((g.player1_id = _player_a AND g.player2_id = _player_b)
      OR (g.player1_id = _player_b AND g.player2_id = _player_a));
$function$;

create or replace function public.admin_list_users()
 returns TABLE(user_id uuid, email text, created_at timestamp with time zone, roles app_role[])
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT u.id, u.email::text, u.created_at,
      COALESCE(ARRAY_AGG(ur.role) FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::app_role[])
    FROM auth.users u
    JOIN public.user_roles ur
      ON ur.user_id = u.id AND ur.club_id = public.current_club_id()
    GROUP BY u.id, u.email, u.created_at
    ORDER BY u.created_at ASC;
END;
$function$;

create or replace function public.admin_user_activity()
 returns TABLE(user_id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, player_name text, games_played integer, average numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT DISTINCT u.id, u.email::text, u.created_at, u.last_sign_in_at,
      p.name, p.games_played, p.average
    FROM auth.users u
    JOIN public.user_roles ur
      ON ur.user_id = u.id AND ur.club_id = public.current_club_id()
    LEFT JOIN public.players p
      ON p.user_id = u.id AND p.club_id = public.current_club_id()
    ORDER BY u.last_sign_in_at DESC NULLS LAST;
END;
$function$;

create or replace function public.admin_list_active_tournaments()
 returns SETOF tournaments
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT * FROM public.tournaments
    WHERE status = 'active'
      AND club_id = public.current_club_id()
    ORDER BY created_at DESC;
END;
$function$;

create or replace function public.admin_tournament_forecast_mode_stats()
 returns TABLE(mode text, best_of_legs integer, avg_legs_per_match numeric, match_count bigint, avg_darts_per_leg numeric, leg_count bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    WITH match_stats AS (
      SELECT g.mode, g.best_of_legs,
             AVG(g.player1_legs_won + g.player2_legs_won) AS avg_legs_per_match,
             COUNT(*) AS match_count
      FROM public.games g
      WHERE g.club_id = public.current_club_id()
      GROUP BY g.mode, g.best_of_legs
    ),
    leg_stats AS (
      SELECT g.mode,
             AVG(jsonb_array_length(gl.throws)) AS avg_darts_per_leg,
             COUNT(*) AS leg_count
      FROM public.game_legs gl
      JOIN public.games g ON g.id = gl.game_id
      WHERE g.club_id = public.current_club_id()
      GROUP BY g.mode
    )
    SELECT m.mode, m.best_of_legs, m.avg_legs_per_match, m.match_count,
           l.avg_darts_per_leg, l.leg_count
    FROM match_stats m
    LEFT JOIN leg_stats l ON l.mode = m.mode;
END;
$function$;

create or replace function public.admin_tournament_forecast_player_stats()
 returns TABLE(player_name text, mode text, avg_darts_per_leg numeric, leg_count bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT gl.player_name, g.mode,
           AVG(jsonb_array_length(gl.throws)) AS avg_darts_per_leg,
           COUNT(*) AS leg_count
    FROM public.game_legs gl
    JOIN public.games g ON g.id = gl.game_id
    WHERE g.club_id = public.current_club_id()
    GROUP BY gl.player_name, g.mode;
END;
$function$;

create or replace function public.admin_delete_user(_user_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'Admin cannot delete own account';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.club_id = public.current_club_id()
  ) THEN
    RAISE EXCEPTION 'Nur Mitglieder des eigenen Vereins können entfernt werden.';
  END IF;
  DELETE FROM auth.users WHERE id = _user_id;
END;
$function$;

create or replace function public.admin_set_role(_user_id uuid, _role app_role, _grant boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  _club_id uuid := public.current_club_id();
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _club_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _user_id = auth.uid() AND _role = 'admin' AND _grant = false THEN
    RAISE EXCEPTION 'Admin cannot remove own admin role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND ur.club_id = _club_id
  ) THEN
    RAISE EXCEPTION 'Nur Mitglieder des eigenen Vereins können Rollen erhalten.';
  END IF;
  IF _grant THEN
    INSERT INTO public.user_roles (user_id, role, club_id)
    VALUES (_user_id, _role, _club_id)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = _user_id AND role = _role AND club_id = _club_id;
  END IF;
END;
$function$;