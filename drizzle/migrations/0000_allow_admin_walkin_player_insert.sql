-- Admins duerfen Spielerprofile OHNE verknuepften Account anlegen (Walk-in / Kinder von
-- Mitgliedern). Die bestehende Insert-Policy verlangt auth.uid() = user_id, was genau
-- diesen Fall (user_id IS NULL) ausschliesst. Streng club-gescoped.
drop policy if exists "Admins can insert walk-in players" on public.players;
create policy "Admins can insert walk-in players"
on public.players
for insert
to authenticated
with check (
  user_id is null
  and club_id = public.current_club_id()
  and public.has_role(auth.uid(), 'admin')
);
