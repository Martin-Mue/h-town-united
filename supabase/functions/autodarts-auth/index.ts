import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Abuse backstop, not normal-usage throttling — matches analyze-dartboard/send-push. "connect" and
// "refresh" are both rare, human-triggered actions (once per board setup / once per match start),
// so this is intentionally tighter than analyze-dartboard's 300/hr.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 60 * 1000;
function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// Reconstructed from real, working Autodarts client code (not the official product — Autodarts has
// no published API docs). See the "Autodarts-Integration" plan for sourcing. If Autodarts ever
// changes this, every call below fails loudly (non-2xx / thrown error) rather than silently
// corrupting a token — never comment this out to "just try something else".
const KEYCLOAK_TOKEN_URL = "https://login.autodarts.io/realms/autodarts/protocol/openid-connect/token";
const KEYCLOAK_CLIENT_ID = "autodarts-app";

interface KeycloakTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in?: number;
}

async function keycloakPasswordLogin(email: string, password: string): Promise<KeycloakTokenResponse> {
  const body = new URLSearchParams({
    client_id: KEYCLOAK_CLIENT_ID,
    scope: "openid",
    grant_type: "password",
    username: email,
    password,
  });
  const res = await fetch(KEYCLOAK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    // Never include the response body in the thrown error — on a login failure Keycloak's body may
    // echo back parts of the request. Status code alone is enough to diagnose "wrong password" vs
    // "Autodarts changed something".
    throw new Error(`Autodarts-Login fehlgeschlagen (Status ${res.status})`);
  }
  return res.json();
}

async function keycloakRefresh(refreshToken: string): Promise<KeycloakTokenResponse> {
  const body = new URLSearchParams({
    client_id: KEYCLOAK_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(KEYCLOAK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Autodarts-Token-Refresh fehlgeschlagen (Status ${res.status})`);
  }
  return res.json();
}

// App-layer AES-GCM (Deno's built-in Web Crypto) — this repo has no DB-side crypto precedent
// (no pgsodium/Vault, no CREATE EXTENSION anywhere), so secrets stay "edge-function-only" exactly
// like every other secret in this codebase, just with an extra at-rest encryption step since these
// specifically need to be read back later (unlike e.g. STRIPE_SECRET_KEY, which never round-trips
// through the DB at all).
async function getEncryptionKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("AUTODARTS_TOKEN_ENCRYPTION_KEY");
  if (!raw) throw new Error("AUTODARTS_TOKEN_ENCRYPTION_KEY ist nicht konfiguriert");
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// `aad` binds a ciphertext to the specific row+field it belongs to, so a future bug can't silently
// reattach e.g. one board's refresh-token ciphertext to another board's row, or swap a
// refresh-token ciphertext into the local-api-key column.
async function encryptSecret(plaintext: string, aad: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(cipherBuf)), iv: bytesToBase64(iv) };
}

async function decryptSecret(ciphertextB64: string, ivB64: string, aad: string): Promise<string> {
  const key = await getEncryptionKey();
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivB64), additionalData: new TextEncoder().encode(aad) },
    key,
    base64ToBytes(ciphertextB64),
  );
  return new TextDecoder().decode(plainBuf);
}

interface BoardRow {
  id: string;
  club_id: string;
  board_number: number;
  label: string | null;
  connection_mode: "cloud" | "local";
  local_ip: string | null;
  autodarts_board_id: string | null;
  autodarts_user_email: string | null;
  refresh_token_ciphertext: string | null;
  refresh_token_iv: string | null;
  local_api_key_ciphertext: string | null;
  local_api_key_iv: string | null;
  status: string;
}

interface Credentials {
  cloud?: { accessToken: string; expiresIn: number };
  local?: { apiKey: string; boardId: string | null; ip: string | null };
}

// Builds the response's credential blocks. Prefers a value that was just freshly obtained in THIS
// request (a brand-new login, or the raw local key the caller just supplied) over decrypting the
// stored one, to avoid a redundant Keycloak round-trip right after login. Only touches the DB again
// (to persist a rotated refresh token) when it actually had to call Keycloak's refresh grant.
async function gatherCredentials(
  serviceClient: SupabaseClient,
  boardRow: BoardRow,
  freshCloud: KeycloakTokenResponse | null,
  freshLocal: string | null,
): Promise<Credentials> {
  const result: Credentials = {};
  const aad = `${boardRow.id}:${boardRow.club_id}`;

  if (freshCloud) {
    result.cloud = { accessToken: freshCloud.access_token, expiresIn: freshCloud.expires_in };
  } else if (boardRow.refresh_token_ciphertext && boardRow.refresh_token_iv) {
    const storedRefreshToken = await decryptSecret(boardRow.refresh_token_ciphertext, boardRow.refresh_token_iv, `${aad}:refresh_token`);
    const rotated = await keycloakRefresh(storedRefreshToken);
    // Keycloak may rotate the refresh token on use — always persist whatever came back rather than
    // assuming the old one stays valid.
    const enc = await encryptSecret(rotated.refresh_token, `${aad}:refresh_token`);
    await serviceClient
      .from("autodarts_boards")
      .update({ refresh_token_ciphertext: enc.ciphertext, refresh_token_iv: enc.iv, token_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", boardRow.id);
    result.cloud = { accessToken: rotated.access_token, expiresIn: rotated.expires_in };
  }

  if (freshLocal) {
    result.local = { apiKey: freshLocal, boardId: boardRow.autodarts_board_id, ip: boardRow.local_ip };
  } else if (boardRow.local_api_key_ciphertext && boardRow.local_api_key_iv) {
    const apiKey = await decryptSecret(boardRow.local_api_key_ciphertext, boardRow.local_api_key_iv, `${aad}:local_api_key`);
    result.local = { apiKey, boardId: boardRow.autodarts_board_id, ip: boardRow.local_ip };
  }

  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Authentication required" }, 401);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claimsData?.claims) return jsonResponse({ error: "Authentication required" }, 401);
    const callerId = claimsData.claims.sub as string;

    if (isRateLimited(callerId)) return jsonResponse({ error: "Rate limit exceeded. Please wait a moment." }, 429);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    const boardNumber = Number(body.boardNumber);
    if (!Number.isInteger(boardNumber) || boardNumber <= 0) {
      return jsonResponse({ error: "boardNumber (positive integer) is required" }, 400);
    }
    if (action !== "connect" && action !== "refresh") {
      return jsonResponse({ error: 'action must be "connect" or "refresh"' }, 400);
    }

    // clubId is NEVER taken from the client — always derived from the caller's own membership,
    // exactly like create-checkout-session does for the Stripe flow. A client-supplied clubId
    // would let any authenticated user probe/act on another club's boards.
    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: callerRoles, error: rolesError } = await serviceClient
      .from("user_roles")
      .select("club_id, role")
      .eq("user_id", callerId);
    if (rolesError) throw rolesError;
    const clubId = callerRoles?.[0]?.club_id as string | undefined;
    if (!clubId) return jsonResponse({ error: "No club membership found" }, 403);

    if (action === "connect") {
      // Only a club admin may connect/reconfigure a board — same bar as the Stripe upgrade flow.
      const isAdmin = !!callerRoles?.some((r) => r.role === "admin");
      if (!isAdmin) return jsonResponse({ error: "Only a club admin can connect an Autodarts board" }, 403);

      const label = typeof body.label === "string" ? body.label : undefined;
      const connectionMode = body.connectionMode === "local" ? "local" : body.connectionMode === "cloud" ? "cloud" : undefined;
      const cloud = body.cloud as { email?: string; password?: string } | undefined;
      const local = body.local as { boardId?: string; apiKey?: string; ip?: string } | undefined;
      if (!cloud?.email && !local?.apiKey) {
        return jsonResponse({ error: "Provide cloud.{email,password} and/or local.{boardId,apiKey}" }, 400);
      }

      // Existing row (if any) first — connecting local credentials later must not clobber an
      // already-stored cloud refresh token, and vice versa (this is exactly today's real case:
      // local API key arrives first, cloud login follows later).
      const { data: existing } = await serviceClient
        .from("autodarts_boards")
        .select("id")
        .eq("club_id", clubId)
        .eq("board_number", boardNumber)
        .maybeSingle();

      // aad is bound to the row identity. For a brand-new row that identity doesn't exist yet, so a
      // fresh id is minted up front and used both for the encryption aad and the upserted row's
      // primary key (rather than letting the DB default it), keeping row identity stable through
      // this one request.
      const rowId = existing?.id ?? crypto.randomUUID();
      const rowAad = `${rowId}:${clubId}`;

      const upsertPayload: Record<string, unknown> = {
        id: rowId,
        club_id: clubId,
        board_number: boardNumber,
        updated_at: new Date().toISOString(),
        status: "connected",
        last_error: null,
      };
      if (label !== undefined) upsertPayload.label = label;
      if (connectionMode !== undefined) upsertPayload.connection_mode = connectionMode;
      if (local?.ip !== undefined) upsertPayload.local_ip = local.ip;

      let freshCloudToken: KeycloakTokenResponse | null = null;
      if (cloud?.email && cloud?.password) {
        freshCloudToken = await keycloakPasswordLogin(cloud.email, cloud.password);
        const enc = await encryptSecret(freshCloudToken.refresh_token, `${rowAad}:refresh_token`);
        upsertPayload.refresh_token_ciphertext = enc.ciphertext;
        upsertPayload.refresh_token_iv = enc.iv;
        upsertPayload.autodarts_user_email = cloud.email;
        upsertPayload.token_updated_at = new Date().toISOString();
      }
      let freshLocalKey: string | null = null;
      if (local?.apiKey) {
        freshLocalKey = local.apiKey;
        const enc = await encryptSecret(local.apiKey, `${rowAad}:local_api_key`);
        upsertPayload.local_api_key_ciphertext = enc.ciphertext;
        upsertPayload.local_api_key_iv = enc.iv;
        if (local.boardId) upsertPayload.autodarts_board_id = local.boardId;
      }

      const { data: savedRow, error: upsertError } = await serviceClient
        .from("autodarts_boards")
        .upsert(upsertPayload, { onConflict: "club_id,board_number" })
        .select()
        .single();
      if (upsertError) throw upsertError;

      // The upsert itself already succeeded at this point — if gathering a fresh usable access
      // token/local key fails (e.g. a previously-stored cloud refresh token has since gone stale),
      // that's surfaced as a warning, not a hard failure: the caller asked to connect credentials,
      // and those ARE now stored correctly, even if we couldn't also hand back a ready-to-use token
      // in the same round-trip. A later "refresh" call is what retries that part.
      try {
        const credentials = await gatherCredentials(serviceClient, savedRow as BoardRow, freshCloudToken, freshLocalKey);
        return jsonResponse({ status: "connected", board: { boardNumber, label: savedRow.label, connectionMode: savedRow.connection_mode }, ...credentials });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        console.warn("autodarts-auth connect: stored credentials but could not mint a token", message);
        return jsonResponse({ status: "connected", board: { boardNumber, label: savedRow.label, connectionMode: savedRow.connection_mode }, credentialsWarning: message });
      }
    }

    // action === "refresh": any club member may use an already-connected board — same reasoning as
    // the camera feature (whoever is standing at the board should be able to use it), not
    // admin-gated like "connect".
    const { data: row, error: rowError } = await serviceClient
      .from("autodarts_boards")
      .select("*")
      .eq("club_id", clubId)
      .eq("board_number", boardNumber)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) return jsonResponse({ status: "disconnected", error: "Board not connected" }, 404);

    try {
      const credentials = await gatherCredentials(serviceClient, row as BoardRow, null, null);
      return jsonResponse({ status: "connected", ...credentials });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      await serviceClient.from("autodarts_boards").update({ status: "error", last_error: message, updated_at: new Date().toISOString() }).eq("id", row.id);
      return jsonResponse({ status: "error", error: message }, 502);
    }
  } catch (e) {
    console.error("autodarts-auth error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
