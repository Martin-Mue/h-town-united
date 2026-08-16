import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// Captured once, at build time (whatever machine/CI actually runs `npm run build`) — lets the
// running app show which commit it was built from, so an installed PWA's version can be checked
// against the repo instead of just trusting the service-worker update plumbing worked.
const commitSha = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
})();
const buildTime = new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(commitSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      // Registered manually in main.tsx instead of the plugin's auto-injected script — the
      // default script has no update-handling logic at all, so a returning visitor's already-
      // open tab kept showing the stale cached UI until a manual hard reload. main.tsx adds the
      // one missing piece: reload once (and only once) when a newer service worker actually
      // takes over an already-controlled page.
      injectRegister: false,
      // Custom service worker (src/sw.ts) instead of the fully-generated one — same
      // app-shell-only precaching policy as before, but this lets the SW also handle Web
      // Push (`push`/`notificationclick`), which the generateSW strategy can't do.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,jpg,jpeg,svg,ico,woff2}"],
      },
      manifest: {
        name: "H-Town United e.V. · Darts Club",
        short_name: "H-Town United",
        description: "Von Heiligenhausern für Heiligenhaus – Spiele, Turniere und Statistiken für den Dartsclub.",
        theme_color: "#0b0f17",
        background_color: "#0b0f17",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
