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
}

createRoot(document.getElementById("root")!).render(<App />);
