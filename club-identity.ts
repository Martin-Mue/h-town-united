// Single source of truth for one native/PWA build's app identity. Read by both vite.config.ts
// (PWA manifest) and capacitor.config.ts (native app id/name/icon) so cutting a differently
// branded build for a different club later means changing only the values here, not either config
// file itself.
//
// This deliberately only covers what's fixed at BUILD time and can't be resolved after install --
// the icon on a phone's home screen, the app name in Android/Play Store listings, and the PWA
// manifest. In-app branding (name, logo, theme) is unrelated and already fully dynamic per logged
// in user via ClubBrandingContext -- every native build still loads the SAME shared deployment
// (see capacitor.config.ts's server.url) and shows each member their own club's branding at
// runtime, same as the web app already does.
//
// appId follows Android/Play Store's reverse-DNS convention and is PERMANENT once a build is ever
// published under it -- safe to change freely before the first real Play Console submission, not
// after.
export const CLUB_IDENTITY = {
  appId: "com.dartspot.club",
  appName: "DartSpot",
  shortName: "DartSpot",
  description: "Turniere, Ligen und Statistiken für deinen Dartverein.",
  themeColor: "#0b0f17",
  backgroundColor: "#0b0f17",
  icon192: "/pwa-192.png",
  icon512: "/pwa-512.png",
  iconMaskable512: "/pwa-maskable-512.png",
};
