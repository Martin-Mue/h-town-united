-- Runde-3-Sicherheitsaudit: "Admins can update club branding" (20260830120000_add_club_branding.sql)
-- ist die einzige verbliebene Policy auf `clubs`, die 20260901155333/20260905090000 beim
-- club_id-Scoping übersehen haben -- sie prüft bis heute nur has_role(admin), ohne
-- `id = current_club_id()`. Die SELECT-Policy auf clubs wurde in 20260901155333 bereits korrekt
-- auf `id = current_club_id()` umgestellt ("Club members can view their own club"); diese
-- UPDATE-Policy blieb als einzige Ausnahme zurück.
--
-- Konkreter Exploit-Pfad vor diesem Fix: `clubs_public` (20260901155333) exponiert die `id` jedes
-- Vereins öffentlich (auch für anon). Der Spalten-Grant `update (name, tagline, logo_path,
-- theme_preset)` (20260903120000) ist zwar korrekt auf die Branding-Spalten beschränkt, aber
-- nicht zeilenweise -- jeder Admin irgendeines Vereins konnte also per
-- `update clubs set name=..., logo_path=..., theme_preset=... where id = '<fremde-club-id>'`
-- Name/Logo/Theme/Tagline eines beliebigen ANDEREN Vereins überschreiben.
--
-- Fix folgt exakt dem in 20260905090000 etablierten Muster: club_id = current_club_id() vor
-- has_role() ergänzen, sowohl in USING als auch WITH CHECK.
drop policy "Admins can update club branding" on public.clubs;
create policy "Admins can update club branding"
  on public.clubs for update
  to authenticated
  using (id = public.current_club_id() and public.has_role(auth.uid(), 'admin'))
  with check (id = public.current_club_id() and public.has_role(auth.uid(), 'admin'));
