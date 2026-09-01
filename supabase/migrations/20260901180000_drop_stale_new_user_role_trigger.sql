-- Phase 2 follow-up: actually retire the auth.users trigger that 20260831120000's own comment
-- already called "the retired handle_new_user_role() trigger" -- it never was. It still fired on
-- every signup and unconditionally inserted into public.user_roles(user_id, role) with no
-- club_id, which broke EVERY new signup (not just a specific account) the moment
-- user_roles.club_id went NOT NULL in stage 1: the INSERT violated the constraint, and since this
-- runs inside the same transaction as the auth.users row creation, the whole signup failed.
--
-- Superseded by create_club(), accept_club_invite() and the join-request approval path, which
-- each insert their own correctly-club_id'd user_roles row explicitly -- club membership is no
-- longer automatic at signup, by design (see RequireClub in App.tsx).
drop trigger if exists on_auth_user_created_assign_role on auth.users;
drop function if exists public.handle_new_user_role();
