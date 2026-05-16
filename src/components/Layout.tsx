import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, Target, Trophy, Dumbbell, Users, LogOut, BarChart3 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import htuLogo from "@/assets/htu-logo.jpg";

const NAV_ITEMS = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/game", icon: Target, label: "Spiel" },
  { to: "/statistics", icon: BarChart3, label: "Stats" },
  { to: "/training", icon: Dumbbell, label: "Training" },
  { to: "/tournament", icon: Trophy, label: "Turnier" },
  { to: "/players", icon: Users, label: "Verein" },
];

const Layout = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <img
            src={htuLogo}
            alt="H-Town United e.V. Darts Logo"
            className="w-12 h-12 rounded-xl object-cover border border-primary/30 glow-cyan"
          />
          <div className="leading-tight">
            <h1 className="text-lg font-display uppercase tracking-widest text-foreground">
              H-Town <span className="text-primary">United</span> <span className="text-muted-foreground text-xs">e.V.</span>
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Dart Club</p>
          </div>
        </Link>

        <div className="flex items-center gap-1">
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
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <Button variant="ghost" size="icon" onClick={signOut} title="Abmelden">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <main className="flex-1 pb-20 md:pb-6">{children}</main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border flex justify-around py-2 z-50">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-xs transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? "drop-shadow-[0_0_6px_hsl(185,85%,48%)]" : ""}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};

export default Layout;
