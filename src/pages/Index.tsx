import { Link } from "react-router-dom";
import { Target, Users, Trophy, Camera, Dumbbell } from "lucide-react";

/** Dashboard statistics (will be dynamic once Cloud is connected) */
const DASHBOARD_STATS = [
  { label: "Mitglieder", value: "12", icon: Users, colorClass: "text-secondary" },
  { label: "Spiele", value: "89", icon: Target, colorClass: "text-primary" },
  { label: "Turniere", value: "3", icon: Trophy, colorClass: "text-accent" },
];

/** Quick action navigation cards */
const QUICK_ACTIONS = [
  { to: "/game", label: "Neues Spiel", desc: "501 · 301 · Cricket", icon: Target },
  { to: "/tournament", label: "Turnier", desc: "K.O.-System", icon: Trophy },
  { to: "/training", label: "Training", desc: "Drills & Coaching", icon: Dumbbell },
  { to: "/camera", label: "Kamera", desc: "Auto-Scoring", icon: Camera },
];

/** Placeholder recent games (will be replaced by DB data) */
const RECENT_GAMES = [
  { p1: "Max", p2: "Anna", mode: "501", winner: "Anna", date: "Heute" },
  { p1: "Tom", p2: "Lisa", mode: "301", winner: "Tom", date: "Gestern" },
  { p1: "Jan", p2: "Paul", mode: "Cricket", winner: "Jan", date: "10.02." },
];

/**
 * Main dashboard / landing page.
 * Shows club branding, stats overview, quick actions, and recent games.
 */
const DashboardPage = () => {
  return (
    <div className="container py-6 animate-slide-up">
      {/* Hero with prominent H-Town United branding */}
      <div className="gradient-hero rounded-2xl p-8 md:p-12 mb-6 border border-border relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(185_85%_48%/0.06),transparent_60%)]" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center glow-cyan">
              <span className="font-display text-primary font-bold text-2xl">H</span>
            </div>
            <div>
              <h1 className="text-4xl md:text-5xl font-display uppercase leading-none">
                H-Town <span className="text-primary">United</span>
              </h1>
              <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground font-display">
                Dart Club
              </p>
            </div>
          </div>
          <p className="text-muted-foreground max-w-md mt-4">
            Verwalte deinen Verein, tracke Scores und organisiere Turniere – alles in einer App.
          </p>
        </div>
      </div>

      {/* Statistics overview */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {DASHBOARD_STATS.map((stat) => (
          <div key={stat.label} className="bg-card rounded-xl p-3 md:p-4 border border-border text-center">
            <stat.icon className={`w-5 h-5 ${stat.colorClass} mx-auto mb-1`} />
            <p className="text-2xl font-display">{stat.value}</p>
            <p className="text-[10px] md:text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Quick action cards */}
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-3">Schnellzugriff</h2>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-all group"
          >
            <action.icon className="w-6 h-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
            <p className="font-semibold text-sm">{action.label}</p>
            <p className="text-xs text-muted-foreground">{action.desc}</p>
          </Link>
        ))}
      </div>

      {/* Recent games feed */}
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-3">Letzte Spiele</h2>
      <div className="space-y-2">
        {RECENT_GAMES.map((game, index) => (
          <div key={index} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs bg-muted px-2 py-0.5 rounded-md font-mono">{game.mode}</span>
              <span className="text-sm">
                {game.p1} <span className="text-muted-foreground">vs</span> {game.p2}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{game.date}</span>
              <span className="text-xs text-secondary font-medium">{game.winner} ✓</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DashboardPage;
