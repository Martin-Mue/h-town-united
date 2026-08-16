/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by vite.config.ts's `define` — the git short SHA and ISO timestamp of the build,
// so the running app can show which commit it's actually running.
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
