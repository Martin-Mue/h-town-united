import type { CapacitorConfig } from "@capacitor/cli";
import { CLUB_IDENTITY } from "./club-identity";

// server.url points the native shell at the SAME live Lovable deployment the web app already
// uses, instead of bundling a static snapshot into the binary. This means ordinary content/logic
// updates (the existing commit -> auto-deploy workflow) reach installed native apps immediately,
// same as the web app -- no Play Store review needed for those. A native rebuild + store
// resubmission is only needed for changes to this shell itself (icon, permissions, native plugins).
// webDir is required by the CapacitorConfig type even though server.url means it's never actually
// served from device -- Capacitor falls back to it only if server.url is unreachable at launch.
const config: CapacitorConfig = {
  appId: CLUB_IDENTITY.appId,
  appName: CLUB_IDENTITY.appName,
  webDir: "dist",
  server: {
    url: "https://h-town-united.lovable.app",
    androidScheme: "https",
  },
};

export default config;
