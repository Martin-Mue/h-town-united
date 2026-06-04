-- Club-wide game visibility for authenticated members
DROP POLICY IF EXISTS "Members can view games they participated in" ON public.games;
CREATE POLICY "Authenticated members can view games"
  ON public.games FOR SELECT
  TO authenticated
  USING (true);

-- Keep role reads available, but force role changes through SECURITY DEFINER RPCs
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
