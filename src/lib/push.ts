import { supabase } from "@/integrations/supabase/client";

// Public VAPID key — safe to ship in client code (only the matching private key, held as a
// Supabase edge function secret, can actually sign/send pushes). Regenerated 2026-09-04 (the
// previous key pair's private half was unrecoverable) — must match VAPID_PUBLIC_KEY in the
// send-push edge function's secrets, see supabase/functions/send-push.
const VAPID_PUBLIC_KEY = "BHeUAzMydhdKntNo7g6a1bkdLeIx6dlZc-n1oG9ntdbJ_Rcn6a7d8oDwMPK64RQjwcdOyS1iDQ3W3AktlxmlYOU";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** A PushSubscription persists in the browser across a server-side VAPID key rotation — the
 *  browser has no way to know the private half changed, so `pushManager.getSubscription()` keeps
 *  returning the old one as if nothing happened. A push signed with the NEW key then silently
 *  fails to reach it (the push service rejects a mismatched key), and — worse — the Settings
 *  toggle still reads "enabled" because a subscription object still exists. Detected by comparing
 *  the subscription's own applicationServerKey (the key it was actually created with) against
 *  today's VAPID_PUBLIC_KEY; a mismatch means it predates the 2026-09-04 rotation (or any future
 *  one) and needs to be dropped instead of trusted. */
function isSubscriptionCurrent(sub: PushSubscription): boolean {
  const current = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const used = sub.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
  if (!used || used.length !== current.length) return false;
  return used.every((byte, i) => byte === current[i]);
}

/** The one place both read paths below go through — returns the existing subscription only if
 *  it still matches today's VAPID key, otherwise tears down a stale one (client AND server side,
 *  so a dead row doesn't linger in push_subscriptions either) and returns null so the caller
 *  re-subscribes fresh instead of silently keeping something nothing can deliver to. */
async function getValidSubscription(reg: ServiceWorkerRegistration): Promise<PushSubscription | null> {
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  if (isSubscriptionCurrent(sub)) return sub;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* best-effort — a stale endpoint may already 404 */ }
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return null;
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return getValidSubscription(reg);
}

/** Requests notification permission, subscribes via the service worker, and stores the
 *  subscription server-side so edge functions can push to this device later. */
export async function subscribeToPush(userId: string, clubId: string | null): Promise<boolean> {
  if (!isPushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await navigator.serviceWorker.ready;
  let sub = await getValidSubscription(reg);
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).slice().buffer as ArrayBuffer,
    });
  }
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: userId, club_id: clubId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
    { onConflict: "endpoint" }
  );
  return !error;
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}
