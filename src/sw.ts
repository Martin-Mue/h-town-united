/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";
import { clientsClaim } from "workbox-core";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// App-shell caching only — scoring/stats still need a live Supabase connection, this just
// means the app itself loads instantly even on weak venue wifi and can be installed to the
// home screen. Same policy as the previous generateSW config; switching to injectManifest
// only so this file can also handle Web Push (see below), which generateSW mode can't do.
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(({ url }) => url.hostname.endsWith(".supabase.co"), new NetworkOnly());

self.skipWaiting();
clientsClaim();

// ─── Web Push ──────────────────────────────────────────────────────────
// Sent by the send-push edge function (see supabase/functions/send-push) — e.g. "your
// tournament match is up next". A push event with no listener shows nothing (or a generic
// browser-chosen notification), so this is required for push to actually appear.
self.addEventListener("push", (event) => {
  let payload: { title?: string; body?: string; url?: string } = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() };
  }
  const title = payload.title ?? "H-Town United Darts";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body,
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      data: { url: payload.url ?? "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
