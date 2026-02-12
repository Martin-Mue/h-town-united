import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, Users, Target, Trophy, Camera } from "lucide-react";

const navItems = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/players", icon: Users, label: "Spieler" },
  { to: "/game", icon: Target, label: "Spiel" },
  { to: "/tournament", icon: Trophy, label: "Turnier" },
  { to: "/camera", icon: Camera, label: "Kamera" },
];

const Layout = ({ children }: { children: ReactNode }) => {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center glow-red">
            <Target className="w-5 h-5 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-display uppercase tracking-wider text-foreground">
            Dart<span className="text-primary">Club</span>
          </h1>
        </Link>
        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
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
      </header>

      {/* Main content */}
      <main className="flex-1 pb-20 md:pb-6">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border flex justify-around py-2 z-50">
        {navItems.map((item) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-xs transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <item.icon className={`w-5 h-5 ${active ? "drop-shadow-[0_0_6px_hsl(var(--primary))]" : ""}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};

export default Layout;
