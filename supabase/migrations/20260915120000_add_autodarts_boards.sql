-- Autodarts-Integration: pro Club eine oder mehrere Board-Verbindungen (Cloud-OAuth-Refresh-Token
-- + optional lokaler Board-Manager-API-Key). Zugangsdaten werden ausschließlich über die
-- autodarts-auth Edge Function geschrieben (Service-Role-Client) -- es gibt bewusst KEINE
-- INSERT-Policy/-Grant für authenticated, siehe unten.
--
-- Gleiches Schutzmuster wie clubs.stripe_customer_id/-subscription_id
-- (20260903110000/20260903120000_restrict_clubs_billing_columns.sql): Blanket-Grant entziehen,
-- expliziter Spalten-Allowlist, sensible Spalten (Autodarts-Board-UUID, verschlüsselte Tokens)
-- gar nicht gegrantet, plus Trigger als zweite Schutzebene.
--
-- Kein DB-seitiges Crypto (kein pgsodium/Vault -- unpräzedenziert in diesem Repo, keine einzige
-- CREATE EXTENSION-Migration existiert): refresh_token/local_api_key werden app-seitig in der
-- Edge Function per AES-GCM verschlüsselt (Deno crypto.subtle,
-- AUTODARTS_TOKEN_ENCRYPTION_KEY-Secret) und nur als Ciphertext+IV (base64) abgelegt.

create table public.autodarts_boards (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  -- Gleicher Nummernraum wie tournaments.boards / TournamentLink.board (Board-Modus-Auto-Start),
  -- damit GameSetup.tsx ein Turnier-Board automatisch auf ein Autodarts-Board mappen kann.
  board_number integer not null,
  label text,
  connection_mode text not null default 'cloud' check (connection_mode in ('cloud', 'local')),
  local_ip text,
  autodarts_board_id text,
  autodarts_user_email text,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  local_api_key_ciphertext text,
  local_api_key_iv text,
  token_updated_at timestamptz,
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, board_number)
);

create index idx_autodarts_boards_club_id on public.autodarts_boards(club_id);

alter table public.autodarts_boards enable row level security;

create policy "Club members can view their club's autodarts boards"
  on public.autodarts_boards for select
  to authenticated
  using (club_id = public.current_club_id());

create policy "Club admins can update their club's autodarts boards"
  on public.autodarts_boards for update
  to authenticated
  using (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'));

create policy "Club admins can delete their club's autodarts boards"
  on public.autodarts_boards for delete
  to authenticated
  using (club_id = public.current_club_id() and public.has_role(auth.uid(), 'admin'));

-- Bewusst keine INSERT-Policy: neue Zeilen entstehen ausschließlich in autodarts-auth (action
-- "connect"), das die verschlüsselten Token-Spalten ohnehin atomar mit der Zeile selbst schreiben
-- muss -- es gibt keinen legitimen Client-seitigen Insert-Pfad, den man hier unterstützen müsste.

revoke select, insert, update, references on public.autodarts_boards from authenticated, anon;

grant select (id, club_id, board_number, label, connection_mode, local_ip, autodarts_user_email,
              status, last_error, created_at, updated_at)
  on public.autodarts_boards to authenticated;
-- autodarts_board_id, refresh_token_ciphertext/_iv, local_api_key_ciphertext/_iv,
-- token_updated_at bewusst ausgeschlossen -- exakt die gleiche Behandlung wie
-- clubs.stripe_customer_id: nur der Service-Role-Client innerhalb von autodarts-auth liest/schreibt sie.

grant update (label, connection_mode, local_ip, updated_at) on public.autodarts_boards to authenticated;
-- Harmlose Admin-Bearbeitung (umbenennen, lokale IP pflegen, cloud/local-Präferenz umschalten)
-- direkt über die App -- alles Token-/Identitäts-bezogene bleibt exklusiv bei der Edge Function.

-- Zweite Schutzebene, gleiches Muster wie restrict_club_billing_edits
-- (20260903110000_add_stripe_billing_columns.sql:21-37): blockt jeden JWT-tragenden Schreibzugriff
-- auf die sensiblen Spalten, selbst falls eine künftige Migration die Grants oben versehentlich
-- lockert.
create or replace function public.restrict_autodarts_board_credential_edits()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and (
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

drop trigger if exists autodarts_boards_restrict_credential_edits on public.autodarts_boards;
create trigger autodarts_boards_restrict_credential_edits before update on public.autodarts_boards
  for each row execute function public.restrict_autodarts_board_credential_edits();
