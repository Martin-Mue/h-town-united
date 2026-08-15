-- Players created directly via the Players page (not through registration self-claim) have
-- user_id = NULL, and the existing "Users can delete their own players" policy
-- (USING (auth.uid() = user_id)) can never match a NULL user_id — nobody could ever remove
-- those profiles, including the admin who created them. Adds an admin-only policy on top
-- (RLS policies for the same operation are OR'd together, so the self-service one keeps working).
CREATE POLICY "Admins can delete any player"
  ON public.players FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
