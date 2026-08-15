import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Registers the service worker and — the part the plugin's default auto-injected script
// doesn't do — reloads the page exactly once when a *newer* worker actually takes over an
// already-controlled tab. Without this, a returning visitor's already-open tab kept showing
// the stale cached UI right after a deploy until they did a manual hard reload; the SW itself
// (skipWaiting + clientsClaim in sw.ts) was already updating in the background the whole time,
// the page just never re-read the new assets. Guarded by `hadController` so this never fires
// on a brand new install (no previous worker to "update" from, nothing stale to fix).
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  import("virtual:pwa-register").then(({ registerSW }) => registerSW({ immediate: true }));

  // Browsers only check the server for a new sw.js roughly once every 24h by default (per
  // spec) — a tab/installed app left open, or just reopened before that window elapses, can
  // sit on a stale worker far longer than the gap between deploys. Forcing a check on load and
  // every time the app becomes visible again (the actual PWA usage pattern — installed apps
  // mostly get reopened from the background, not freshly loaded) closes that gap without
  // waiting on the browser's own timing.
  const forceUpdateCheck = () => {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.update().catch(() => {}));
    });
  };
  window.addEventListener("load", forceUpdateCheck);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") forceUpdateCheck();
  });
}

createRoot(document.getElementById("root")!).render(<App />);
