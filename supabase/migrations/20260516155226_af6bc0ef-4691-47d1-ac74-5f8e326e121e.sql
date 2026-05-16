-- 1) Rollen-Enum & Tabelle
CREATE TYPE public.app_role AS ENUM ('admin', 'member');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 2) Security-definer Rollenprüfung
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 3) RLS Policies user_roles
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4) Trigger: ersten Nutzer als Admin, weitere als Member
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count int;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  IF user_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_assign_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- Bestehende Nutzer nachträglich versorgen (ersten als Admin)
INSERT INTO public.user_roles (user_id, role)
SELECT id,
  CASE WHEN row_number() OVER (ORDER BY created_at) = 1 THEN 'admin'::public.app_role
       ELSE 'member'::public.app_role END
FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- 5) Games RLS erweitern: Spieler sehen Spiele in denen sie mitgespielt haben; Admins sehen alles
DROP POLICY IF EXISTS "Users can view their own games" ON public.games;

CREATE POLICY "Members can view games they participated in"
  ON public.games FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.user_id = auth.uid()
        AND (p.id = games.player1_id OR p.id = games.player2_id)
    )
  );

-- 6) Aggregierte Vereinsstatistiken (security definer, gibt nur Aggregate zurück)
CREATE OR REPLACE FUNCTION public.club_leaderboard()
RETURNS TABLE (
  player_id uuid,
  player_name text,
  emoji text,
  games_played bigint,
  games_won bigint,
  avg_score numeric,
  highscore int,
  win_rate numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    LEFT JOIN public.games g ON g.player1_id = pl.id OR g.player2_id = pl.id
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
$$;

-- 7) Head-to-Head zwischen zwei Mitgliedern
CREATE OR REPLACE FUNCTION public.club_head_to_head(_player_a uuid, _player_b uuid)
RETURNS TABLE (
  total_games bigint,
  a_wins bigint,
  b_wins bigint,
  a_avg numeric,
  b_avg numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*) AS total_games,
    COUNT(*) FILTER (WHERE g.winner_id = _player_a) AS a_wins,
    COUNT(*) FILTER (WHERE g.winner_id = _player_b) AS b_wins,
    ROUND(AVG(CASE WHEN g.player1_id = _player_a THEN g.player1_average
                   WHEN g.player2_id = _player_a THEN g.player2_average END)::numeric, 1) AS a_avg,
    ROUND(AVG(CASE WHEN g.player1_id = _player_b THEN g.player1_average
                   WHEN g.player2_id = _player_b THEN g.player2_average END)::numeric, 1) AS b_avg
  FROM public.games g
  WHERE (g.player1_id = _player_a AND g.player2_id = _player_b)
     OR (g.player1_id = _player_b AND g.player2_id = _player_a);
$$;

GRANT EXECUTE ON FUNCTION public.club_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.club_head_to_head(uuid, uuid) TO authenticated;