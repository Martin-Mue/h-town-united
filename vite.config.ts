import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      // App-shell caching only — scoring/stats still need a live Supabase connection,
      // this just means the app itself loads instantly even on weak venue wifi and can
      // be installed to the home screen.
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,jpg,jpeg,svg,ico,woff2}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith(".supabase.co"),
            handler: "NetworkOnly",
          },
        ],
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
