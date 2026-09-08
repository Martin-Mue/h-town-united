import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { CLUB_IDENTITY } from "./club-identity";

// Captured once, at build time (whatever machine/CI actually runs `npm run build`) — lets the
// running app show which commit it was built from, so an installed PWA's version can be checked
// against the repo instead of just trusting the service-worker update plumbing worked.
//
// `git rev-parse` alone worked fine building locally all session, but came back empty the first
// time a build actually went through Lovable's own cloud pipeline instead — that environment
// apparently doesn't have `.git` (or `git` itself) available. Try common CI-injected commit-SHA
// env vars first (covers the usual naming across Vercel/Netlify/Cloudflare Pages/GitHub Actions,
// on the chance Lovable's build environment sets one of these), then fall back to asking git
// directly for local/dev builds, and only give up to "unknown" if neither works.
const commitSha = (() => {
  const fromEnv = [
    process.env.VITE_GIT_COMMIT_SHA,
    process.env.COMMIT_SHA,
    process.env.GIT_COMMIT,
    process.env.SOURCE_VERSION,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.CF_PAGES_COMMIT_SHA,
    process.env.GITHUB_SHA,
  ].find((v) => v && v.trim());
  if (fromEnv) return fromEnv.trim().slice(0, 7);
  try {
    const sha = execSync("git rev-parse --short HEAD").toString().trim();
    if (sha) return sha;
  } catch {
    /* no git available in this build environment either */
  }
  return "unknown";
})();
const buildTime = new Date().toISOString();

// Regenerates src/i18n/generated/<lang>.json from the single-source src/i18n/translations.ts (see
// scripts/generate-locales.mjs's own doc comment) -- runs once at both dev-server start and build
// start, and again whenever translations.ts changes during dev, so the generated per-language
// files this app's runtime actually loads (LanguageContext.tsx) can never silently drift out of
// sync with the source anyone actually edits. Spawned as its own `node` process (not imported
// in-process) specifically so it doesn't depend on whatever flags/loader Vite's own process
// happens to be running under -- self-contained regardless of how `npm run dev`/`build` end up
// invoking things internally.
function i18nGeneratedLocales() {
  // throwOnError distinguishes "npm run build" from the dev server: a production build that
  // ships without valid src/i18n/generated/<lang>.json files is far worse than one that fails
  // outright here -- every t(key) call in the shipped app silently falls back to showing the raw
  // key ("nav.home" instead of "Home") with nothing in the browser console to explain why, which
  // is exactly the failure this plugin exists to prevent. Previously this step only logged and
  // let the build continue regardless of whether generation actually succeeded -- fine for local
  // dev (a mid-edit syntax error in translations.ts shouldn't kill the whole dev server), but it
  // meant a build-environment-specific failure here (a missing/mismatched esbuild binary, `node`
  // not on PATH, ...) could ship completely broken translations with a fully green build log.
  const regenerate = (throwOnError: boolean) => {
    try {
      execSync("node scripts/generate-locales.mjs", { stdio: "inherit" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[i18n] locale generation failed:", message);
      if (throwOnError) throw new Error(`[i18n] locale generation failed during build: ${message}`);
    }
  };
  return {
    name: "i18n-generated-locales",
    buildStart() { regenerate(true); },
    configureServer(server) {
      regenerate(false);
      const translationsFile = path.resolve(__dirname, "src/i18n/translations.ts");
      server.watcher.add(translationsFile);
      server.watcher.on("change", (file) => { if (path.resolve(file) === translationsFile) regenerate(false); });
    },
  };
}

// Round 4 Rang 3: index.html's <title>/description/author/OG/favicon were hardcoded to one
// specific club's real name and logo ("H-Town United e.V.") even though this is a shared,
// multi-club deployment -- see ClubBrandingContext.tsx's own doc comment, which already made
// document.title/favicon dynamic per logged-in user's club at runtime but explicitly flagged
// "the harder PWA-manifest problem (vite.config.ts, index.html meta/OG tags)... stays out of
// scope". This closes that gap the same way CLUB_IDENTITY already closes it for the PWA manifest
// below and for capacitor.config.ts: one neutral, build-time identity, so anyone who hits the app
// before React hydrates (crawlers, link-preview bots, the very first paint) sees the platform's
// own generic branding rather than one specific club's. index.html carries literal "DartSpot"
// placeholders (see its own comment) purely so it stays valid, readable HTML on its own --
// this plugin is what actually makes CLUB_IDENTITY the one place a rebrand needs to touch.
function htmlIdentityPlugin() {
  const title = CLUB_IDENTITY.appName;
  return {
    name: "html-identity",
    transformIndexHtml(html: string) {
      return html
        .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
        .replace(/<meta name="description" content=".*?" \/>/, `<meta name="description" content="${CLUB_IDENTITY.description}" />`)
        .replace(/<meta name="author" content=".*?" \/>/, `<meta name="author" content="${CLUB_IDENTITY.appName}" />`)
        .replace(/<link rel="icon"[^>]*\/>/, `<link rel="icon" type="image/png" href="${CLUB_IDENTITY.icon192}" />`)
        .replace(/<meta property="og:title" content=".*?" \/>/, `<meta property="og:title" content="${title}" />`)
        .replace(/<meta property="og:description" content=".*?" \/>/, `<meta property="og:description" content="${CLUB_IDENTITY.description}" />`)
        .replace(/<meta property="og:image" content=".*?" \/>/, `<meta property="og:image" content="${CLUB_IDENTITY.icon512}" />`)
        .replace(/<meta name="twitter:image" content=".*?" \/>/, `<meta name="twitter:image" content="${CLUB_IDENTITY.icon512}" />`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    // Visual Studio's own project-index files under .vs/ can be locked by VS itself while it's
    // open, which crashes Vite's file watcher outright (EBUSY) the moment it tries to watch one
    // -- excluding the folder avoids depending on VS being closed just to run the dev server.
    watch: {
      ignored: ["**/.vs/**"],
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(commitSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [
    i18nGeneratedLocales(),
    htmlIdentityPlugin(),
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
        name: `${CLUB_IDENTITY.appName} · Darts Club`,
        short_name: CLUB_IDENTITY.shortName,
        description: CLUB_IDENTITY.description,
        theme_color: CLUB_IDENTITY.themeColor,
        background_color: CLUB_IDENTITY.backgroundColor,
        display: "standalone",
        start_url: "/",
        icons: [
          { src: CLUB_IDENTITY.icon192, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: CLUB_IDENTITY.icon512, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: CLUB_IDENTITY.iconMaskable512, sizes: "512x512", type: "image/png", purpose: "maskable" },
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
