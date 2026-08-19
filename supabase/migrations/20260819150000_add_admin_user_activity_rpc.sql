-- Admin-only view of member activity for the new Admin "Statistiken" panel: join auth.users
-- (email, join date, last login timestamp) against players (name, games played, average).
-- Deliberately a separate function from admin_list_users() rather than extending it — that one
-- backs the existing user/role management table and changing its return shape risks breaking
-- that working UI for no benefit to this new, differently-scoped read.
--
-- Note for whoever reads this next: last_sign_in_at is the only login-related signal Supabase's
-- auth.users exposes natively. It is NOT a running login count and it says nothing about how
-- long a session lasted — neither of those is tracked anywhere in this schema. Answering "how
-- many times did X log in" or "how many minutes was X in the app" needs new instrumentation (a
-- table + client-side event recording), not a query against what already exists.
CREATE OR REPLACE FUNCTION public.admin_user_activity()
RETURNS TABLE(
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  player_name text,
  games_played integer,
  average numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT u.id, u.email::text, u.created_at, u.last_sign_in_at,
      p.name, p.games_played, p.average
    FROM auth.users u
    LEFT JOIN public.players p ON p.user_id = u.id
    ORDER BY u.last_sign_in_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_user_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_activity() TO authenticated;
