-- Real bug, hit live immediately on the first connect attempt through the actual admin UI:
-- restrict_autodarts_board_credential_edits (from the original autodarts_boards migration) was
-- written assuming ONLY a service-role, no-JWT caller (the originally-planned Edge Function) would
-- ever legitimately write the sensitive columns, so it blocked any write carrying a real
-- auth.uid() -- full stop. That assumption stopped being true the moment login moved to the
-- autodarts_connect_board/autodarts_refresh_board SECURITY DEFINER RPCs (see the previous
-- migration): those ARE called by a real logged-in admin/member, so auth.uid() is legitimately
-- non-null on their writes too, and the trigger fired every single time, surfacing to the user as
-- "Autodarts-Zugangsdaten können nicht über die App geändert werden."
--
-- Fix follows the exact same pattern already established by
-- restrict_player_profile_edits_to_owner's darts.stat_rollup flag: the trusted RPC sets a
-- session-local GUC right before its own legitimate write (set_config(..., true) = SET LOCAL, so
-- it can never leak past the current transaction), and the trigger only blocks writes where that
-- flag ISN'T set -- restoring the original protection against a client writing these columns
-- directly (no RPC involved, flag absent) while unblocking the legitimate RPC path.
create or replace function public.restrict_autodarts_board_credential_edits()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
    and current_setting('darts.autodarts_internal_write', true) is distinct from 'on'
    and (
    NEW.autodarts_board_id is distinct from OLD.autodarts_board_id
    or NEW.autodarts_user_email is distinct from OLD.autodarts_user_email
    or NEW.refresh_token_ciphertext is distinct from OLD.refresh_token_ciphertext
    or NEW.refresh_token_iv is distinct from OLD.refresh_token_iv
    or NEW.local_api_key_ciphertext is distinct from OLD.local_api_key_ciphertext
    or NEW.local_api_key_iv is distinct from OLD.local_api_key_iv
    or NEW.token_updated_at is distinct from OLD.token_updated_at
    or NEW.status is distinct from OLD.status
    or NEW.last_error is distinct from OLD.last_error
  ) then
    raise exception 'Autodarts-Zugangsdaten können nicht über die App geändert werden.';
  end if;
  return NEW;
end;
$function$;
