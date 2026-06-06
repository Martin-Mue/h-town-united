
-- Allow all authenticated members to view all club games
DROP POLICY IF EXISTS "Members can view games they participated in" ON public.games;
CREATE POLICY "Members can view all club games"
  ON public.games FOR SELECT
  TO authenticated
  USING (true);

-- Restrict direct writes on user_roles; admins must use SECURITY DEFINER RPCs
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
