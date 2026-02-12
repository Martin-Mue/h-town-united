import { Link } from "react-router-dom";
import { Target, Users, Trophy, Camera, ChevronRight, TrendingUp } from "lucide-react";

const stats = [
  { label: "Aktive Spieler", value: "12", icon: Users, color: "text-secondary" },
  { label: "Gespielte Spiele", value: "89", icon: Target, color: "text-primary" },
  { label: "Turniere", value: "3", icon: Trophy, color: "text-accent" },
];

const quickActions = [
  { to: "/game", label: "Neues Spiel", desc: "501, 301 oder Cricket", icon: Target, glow: "glow-red" },
  { to: "/tournament", label: "Turnier starten", desc: "K.O., Doppel-K.O.", icon: Trophy, glow: "glow-gold" },
  { to: "/players", label: "Spieler verwalten", desc: "Profile & Statistiken", icon: Users, glow: "glow-green" },
  { to: "/camera", label: "Kamera Scoring", desc: "Automatische Erkennung", icon: Camera, glow: "" },
];

const recentGames = [
  { p1: "Max", p2: "Anna", mode: "501", winner: "Anna", date: "Heute" },
  { p1: "Tom", p2: "Lisa", mode: "301", winner: "Tom", date: "Gestern" },
  { p1: "Jan", p2: "Paul", mode: "501", winner: "Jan", date: "10.02." },
];

const Index = () => {
  return (
    <div className="container py-6 animate-slide-up">
      {/* Hero */}
      <div className="gradient-hero rounded-2xl p-6 md:p-10 mb-6 border border-border">
        <h1 className="text-3xl md:text-5xl font-display uppercase leading-tight mb-2">
          Dart<span className="text-primary">Club</span>
        </h1>
        <p className="text-muted-foreground max-w-md">
          Verwalte Spieler, tracke Scores und organisiere Turniere – alles in einer App.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="bg-card rounded-xl p-3 md:p-4 border border-border text-center">
            <s.icon className={`w-5 h-5 ${s.color} mx-auto mb-1`} />
            <p className="text-2xl font-display">{s.value}</p>
            <p className="text-[10px] md:text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-3">Schnellzugriff</h2>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {quickActions.map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className={`bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-all group ${a.glow ? `hover:${a.glow}` : ""}`}
          >
            <a.icon className="w-6 h-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
            <p className="font-semibold text-sm">{a.label}</p>
            <p className="text-xs text-muted-foreground">{a.desc}</p>
          </Link>
        ))}
      </div>

      {/* Recent Games */}
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-3">Letzte Spiele</h2>
      <div className="space-y-2">
        {recentGames.map((g, i) => (
          <div key={i} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs bg-muted px-2 py-0.5 rounded-md font-mono">{g.mode}</span>
              <span className="text-sm">
                {g.p1} <span className="text-muted-foreground">vs</span> {g.p2}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{g.date}</span>
              <span className="text-xs text-secondary font-medium">{g.winner} ✓</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Index;
