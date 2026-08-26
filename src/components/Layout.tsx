import { ReactNode, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, Target, Trophy, Dumbbell, Users, LogOut, BarChart3, UserCog, CloudOff, RefreshCw, Settings } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { useOfflineGameQueue } from "@/hooks/useOfflineGameQueue";
import { useOfflineMatchResultQueue } from "@/hooks/useOfflineMatchResultQueue";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import htuLogo from "@/assets/htu-logo.jpg";
import htuEmblem from "@/assets/club-emblem.png";

const NAV_ITEMS = [
  { to: "/", icon: Home, labelKey: "nav.home" },
  { to: "/game", icon: Target, labelKey: "nav.game" },
  { to: "/statistics", icon: BarChart3, labelKey: "nav.stats" },
  { to: "/training", icon: Dumbbell, labelKey: "nav.training" },
  { to: "/tournament", icon: Trophy, labelKey: "nav.tournament" },
  { to: "/players", icon: Users, labelKey: "nav.club" },
];

const Layout = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const isAdmin = useIsAdmin(user?.id);
  const [signingOut, setSigningOut] = useState(false);
  const gameQueue = useOfflineGameQueue();
  const matchResultQueue = useOfflineMatchResultQueue();
  const pendingCount = gameQueue.pendingCount + matchResultQueue.pendingCount;
  const syncing = gameQueue.syncing || matchResultQueue.syncing;
  const { t } = useLanguage();

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
      {/* Subtle full-page watermark so plainer list/empty-state pages don't feel bare */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden flex items-center justify-center">
        <img src={htuEmblem} alt="" aria-hidden="true" className="w-[140vw] max-w-none opacity-[0.03] select-none" />
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
              little room for the full "H-Town United e.V." + "Dart Club" text, it wrapped across
              several lines instead of shrinking, growing the header much taller and dragging the
              nav pills into an off-looking vertical position alongside it. Truncating with an
              ellipsis keeps the header a single, predictable row at any zoom/width. */}
          <Link to="/" className="flex items-center gap-3 min-w-0">
            <img
              src={htuLogo}
              alt="H-Town United e.V. Darts Logo"
              className="w-12 h-12 rounded-xl object-cover border border-primary/30 glow-cyan shrink-0"
            />
            <div className="leading-tight min-w-0">
              <h1 className="text-lg font-display uppercase tracking-widest text-foreground truncate">
                H-Town <span className="text-primary">United</span> <span className="text-muted-foreground text-xs">e.V.</span>
              </h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground truncate">Dart Club</p>
            </div>
          </Link>

          <div className="flex items-center gap-1">
            <img
              src={htuEmblem}
              alt="H-Town United e.V. Vereinsemblem"
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

        <main className="flex-1 pb-20 md:pb-6">{children}</main>
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border flex justify-around py-2 z-50 overflow-x-auto">
        {/* Admin never had an entry here — it only ever existed in the "hidden md:flex" desktop
            nav above, so any admin on mobile had no way to reach it at all. */}
        {[...NAV_ITEMS, ...(isAdmin ? [{ to: "/admin", icon: UserCog, labelKey: "nav.admin" }] : [])].map((item) => {
          const isActive = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-xs transition-colors shrink-0 ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? "drop-shadow-[0_0_6px_hsl(185,85%,48%)]" : ""}`} />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};

export default Layout;
