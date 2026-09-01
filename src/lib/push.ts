import { supabase } from "@/integrations/supabase/client";

// Public VAPID key — safe to ship in client code (only the matching private key, held as a
// Supabase edge function secret, can actually sign/send pushes). Regenerated 2026-08-19 (the
// original private key was never saved anywhere and was unrecoverable) — must match whatever
// VAPID_PUBLIC_KEY is set to in the send-push edge function's secrets, see supabase/functions/send-push.
const VAPID_PUBLIC_KEY = "BHCBpSkqfWzlx1MKr5ZS1jtHhdgnyGQYOAdIEXZhFQpGt2dNh05fewEk5cI7x7X1BcACbQSVUlDwvpO6bTMymhQ";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Requests notification permission, subscribes via the service worker, and stores the
 *  subscription server-side so edge functions can push to this device later. */
export async function subscribeToPush(userId: string, clubId: string | null): Promise<boolean> {
  if (!isPushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
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
