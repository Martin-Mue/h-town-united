import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { toast } from "@/hooks/use-toast";

// Mirrors Game.tsx's own ACTIVE_GAME_KEY constant — duplicated rather than imported since
// main.tsx runs before React (and everything it pulls in) is set up, and this is genuinely just
// one string, not worth restructuring Game.tsx's module boundary over.
const ACTIVE_GAME_KEY = "dartcam-active-game-v1";
const hasActiveGame = () => !!window.localStorage.getItem(ACTIVE_GAME_KEY);

// Registers the service worker and — the part the plugin's default auto-injected script
// doesn't do — reloads the page once a *newer* worker actually takes over an already-controlled
// tab. Without this, a returning visitor's already-open tab kept showing the stale cached UI
// right after a deploy until they did a manual hard reload; the SW itself (skipWaiting +
// clientsClaim in sw.ts) was already updating in the background the whole time, the page just
// never re-read the new assets. Guarded by `hadController` so this never fires on a brand new
// install (no previous worker to "update" from, nothing stale to fix).
//
// Reload timing depends on whether a game is in progress (checked via the same localStorage
// snapshot Game.tsx restores from on load, so it survives navigating away from the Game page
// mid-match): no active game reloads shortly after a toast so the update notice is actually
// visible before the page disappears out from under it; an active game defers the reload until
// that snapshot clears (game finished, abandoned, or reset) instead of yanking the page out from
// under someone mid-throw, but still shows the toast immediately so the update isn't a surprise.
if ("serviceWorker" in navigator) {
  let hadController = !!navigator.serviceWorker.controller;
  let handled = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) {
      // The very first controllerchange this page ever sees is just this tab's first-ever SW
      // activation (fresh install, or a fresh load before any worker existed yet) — nothing
      // stale to reload from, correctly suppressed. But this used to stay `false` for the whole
      // rest of the tab's lifetime, so a SECOND deploy landing while this same tab stayed open
      // (exactly the long-lived-session pattern forceUpdateCheck below is built for) fired
      // controllerchange again yet got silently swallowed by this same check — no toast, no
      // reload, ever, for that update. Flipping it here means every controllerchange after this
      // first one is correctly treated as a real update instead.
      hadController = true;
      return;
    }
    if (handled) return;
    handled = true;

    if (!hasActiveGame()) {
      toast({ title: "Update geladen", description: "Die App wird neu gestartet …" });
      window.setTimeout(() => window.location.reload(), 1500);
      return;
    }

    toast({
      title: "Update verfügbar",
      description: "Wird geladen, sobald das laufende Spiel beendet ist.",
    });
    const waitForGameEnd = window.setInterval(() => {
      if (hasActiveGame()) return;
      window.clearInterval(waitForGameEnd);
      window.location.reload();
    }, 5000);
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
