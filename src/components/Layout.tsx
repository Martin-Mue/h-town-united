import { ReactNode, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LogOut, UserCog, CloudOff, RefreshCw, Settings } from "lucide-react";
import { HomeIcon, DartGameIcon, StatsIcon, TrainingIcon, DartTrophyIcon, ClubIcon } from "@/components/icons/DartIcons";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { Button } from "@/components/ui/button";
import { useOfflineGameQueue } from "@/hooks/useOfflineGameQueue";
import { useOfflineMatchResultQueue } from "@/hooks/useOfflineMatchResultQueue";
import { useOfflineBracketActionQueue } from "@/hooks/useOfflineBracketActionQueue";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import WhatsNewBanner from "@/components/WhatsNewBanner";
import OnboardingTour from "@/components/OnboardingTour";
import htuEmblem from "@/assets/club-emblem.png";

// Icons are DartSpot's own hand-drawn set (src/components/icons/DartIcons.tsx), not lucide —
// see that file's doc comment for why: these six are the icons every member sees on every
// screen (desktop nav above AND the mobile bottom nav further down both read from this same
// array), so they're the highest-value place to look like DartSpot instead of "any shadcn app".
const NAV_ITEMS = [
  { to: "/", icon: HomeIcon, labelKey: "nav.home" },
  { to: "/game", icon: DartGameIcon, labelKey: "nav.game" },
  { to: "/statistics", icon: StatsIcon, labelKey: "nav.stats" },
  { to: "/training", icon: TrainingIcon, labelKey: "nav.training" },
  { to: "/tournament", icon: DartTrophyIcon, labelKey: "nav.tournament" },
  { to: "/players", icon: ClubIcon, labelKey: "nav.club" },
];

const Layout = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const isAdmin = useIsAdmin(user?.id);
  const { club, name: clubName, logoUrl } = useClubBranding();
  // Until a club uploads its own logo, each slot keeps its ORIGINAL bundled artwork (the
  // watermark and the header badge were always two different images) so the app stays
  // pixel-identical to today — only once logo_path is set do all slots switch to the one
  // uploaded image.
  const watermarkSrc = club?.logo_path ? logoUrl : htuEmblem;
  const [signingOut, setSigningOut] = useState(false);
  const gameQueue = useOfflineGameQueue();
  const matchResultQueue = useOfflineMatchResultQueue();
  const bracketActionQueue = useOfflineBracketActionQueue();
  const pendingCount = gameQueue.pendingCount + matchResultQueue.pendingCount + bracketActionQueue.pendingCount;
  const syncing = gameQueue.syncing || matchResultQueue.syncing || bracketActionQueue.syncing;
  const { t } = useLanguage();
  const mobileNavItems = [...NAV_ITEMS, ...(isAdmin ? [{ to: "/admin", icon: UserCog, labelKey: "nav.admin" }] : [])];
  const mobileActiveIndex = mobileNavItems.findIndex((item) => location.pathname === item.to);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="h-[100dvh] bg-background flex flex-col relative overflow-hidden">
      <OnboardingTour />
      {/* Subtle full-page watermark so plainer list/empty-state pages don't feel bare */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden flex items-center justify-center">
        <img src={watermarkSrc} alt="" aria-hidden="true" className="w-[140vw] max-w-none opacity-[0.03] select-none" />
      </div>

      {/* This div — not html/body — owns scrolling and overscroll containment. On iOS Safari,
          overscroll-behavior on html/body breaks position:fixed for any descendant (a WebKit bug),
          which was making the bottom nav below scroll away with the page instead of staying pinned.
          Containing it here instead still stops an accidental pull-to-refresh (e.g. while tapping
          around the live-camera view) from reloading the app mid-game.
          min-h-0 is required, not decorative — a flex item defaults to min-height:auto, which lets
          it grow to fit its content instead of respecting flex-1's share of the parent's height.
          Without it, THIS div never actually became short enough for its own overflow-y-auto to
          engage — page content just grew past the viewport and something further up (ultimately
          whatever the browser falls back to) ended up owning the scroll instead, which is also
          exactly what breaks any `sticky` element inside here: sticky only sticks relative to ITS
          nearest actually-scrolling ancestor, and if this div never becomes that, a `sticky
          top-0` scoreboard inside a page has nothing correct to stick to. */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-y-contain">
        <header className="border-b border-border px-4 py-3 flex items-center justify-between bg-background/80 backdrop-blur-sm relative z-10 shrink-0">
          {/* min-w-0 on both the link and the text wrapper, plus truncate on the text itself —
              without it, a flex child's default min-width:auto refuses to shrink below its
              content's natural width at all, so once zooming (or a narrow window) left too
              little room for the full club name text, it wrapped across several lines instead
              of shrinking, growing the header much taller and dragging the nav pills into an
              off-looking vertical position alongside it. Truncating with an ellipsis keeps the
              header a single, predictable row at any zoom/width. */}
          <Link to="/" className="flex items-center gap-3 min-w-0">
            <img
              src={logoUrl}
              alt={clubName}
              className="w-12 h-12 rounded-xl object-cover border border-primary/30 glow-cyan shrink-0"
            />
            <div className="leading-tight min-w-0">
              <h1 className="text-lg font-display uppercase tracking-widest text-foreground truncate">
                {clubName}
              </h1>
            </div>
          </Link>

          <div className="flex items-center gap-1">
            <img
              src={watermarkSrc}
              alt={t("players.clubEmblemAlt")}
              className="hidden sm:block w-9 h-9 object-contain opacity-60 mr-2"
            />
            <nav className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const isActive = location.pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    {t(item.labelKey)}
                  </Link>
                );
              })}
              {isAdmin && (
                <Link
                  to="/admin"
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    location.pathname === "/admin"
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <UserCog className="w-4 h-4" />
                  {t("nav.admin")}
                </Link>
              )}
            </nav>
            {pendingCount > 0 && (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-500 text-xs font-medium mr-1"
                title={t("header.offlinePendingTooltip")}
              >
                {syncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CloudOff className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{pendingCount} {t("header.offline")}</span>
              </div>
            )}
            <Link to="/settings">
              <Button variant="ghost" size="icon" title={t("header.settings")} aria-label={t("header.settings")}>
                <Settings className="w-4 h-4" />
              </Button>
            </Link>
            <Button variant="ghost" size="icon" onClick={handleSignOut} disabled={signingOut} title={t("header.signOut")} aria-label={t("header.signOut")}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </header>

        <WhatsNewBanner />
        <main className="flex-1 pb-20 md:pb-6">{children}</main>
      </div>

      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border grid py-2 z-50"
        style={{ gridTemplateColumns: `repeat(${mobileNavItems.length}, minmax(0, 1fr))` }}
      >
        {/* Animated pill under the active tab — a `position:fixed` nav is already its own
            positioning context, so this absolute pill needs no extra `relative` wrapper. Slides
            (--ease-spring, a little overshoot) rather than just fading, so switching tabs reads
            as one continuous motion instead of two independent icon color changes. */}
        {mobileActiveIndex >= 0 && (
          <div
            aria-hidden="true"
            className="absolute top-1 bottom-1 rounded-lg bg-primary/10 pointer-events-none"
            style={{
              left: `calc(${mobileActiveIndex} * (100% / ${mobileNavItems.length}))`,
              width: `calc(100% / ${mobileNavItems.length})`,
              transitionProperty: "left",
              transitionDuration: "380ms",
              transitionTimingFunction: "var(--ease-spring)",
            }}
          />
        )}
        {/* Admin never had an entry here — it only ever existed in the "hidden md:flex" desktop
            nav above, so any admin on mobile had no way to reach it at all. */}
        {mobileNavItems.map((item) => {
          const isActive = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`relative flex flex-col items-center gap-0.5 px-2 py-1 text-xs transition-colors active:scale-90 min-w-0 ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
              style={{ transitionTimingFunction: "var(--ease-press)" }}
            >
              <item.icon className={`w-5 h-5 ${isActive ? "drop-shadow-[0_0_6px_hsl(var(--primary))]" : ""}`} />
              <span className="truncate max-w-full">{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
};

export default Layout;
