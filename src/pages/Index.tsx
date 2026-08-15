import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Target, Users, Trophy, Camera, Dumbbell, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import htuLogo from "@/assets/htu-logo.jpg";
import htuEmblem from "@/assets/club-emblem-color.png";

const QUICK_ACTIONS = [
  { to: "/game", label: "Neues Spiel", desc: "501 · 301 · Cricket", icon: Target },
  { to: "/tournament", label: "Turnier", desc: "K.O. · Round Robin", icon: Trophy },
  { to: "/statistics", label: "Statistiken", desc: "Ranglisten & Vergleiche", icon: BarChart3 },
  { to: "/training", label: "Training", desc: "Drills & Coaching", icon: Dumbbell },
  { to: "/players", label: "Verein", desc: "Mitglieder verwalten", icon: Users },
];

interface RecentGame {
  id: string;
  mode: string;
  player1_name: string;
  player2_name: string;
  winner_name: string;
  played_at: string;
}

const DashboardPage = () => {
  const [playerCount, setPlayerCount] = useState(0);
  const [gameCount, setGameCount] = useState(0);
  const [tournamentCount, setTournamentCount] = useState(0);
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);

  useEffect(() => {
    const load = async () => {
      const [p, g, t, rg] = await Promise.all([
        supabase.from("players").select("id", { count: "exact", head: true }),
        supabase.from("games").select("id", { count: "exact", head: true }),
        supabase.from("tournaments").select("id", { count: "exact", head: true }),
        supabase.from("games").select("id, mode, player1_name, player2_name, winner_name, played_at").order("played_at", { ascending: false }).limit(5),
      ]);
      setPlayerCount(p.count ?? 0);
      setGameCount(g.count ?? 0);
      setTournamentCount(t.count ?? 0);
      if (rg.data) setRecentGames(rg.data);
    };
    load();
  }, []);

  const DASHBOARD_STATS = [
    { label: "Mitglieder", value: playerCount, icon: Users, colorClass: "text-secondary" },
    { label: "Spiele", value: gameCount, icon: Target, colorClass: "text-primary" },
    { label: "Turniere", value: tournamentCount, icon: Trophy, colorClass: "text-accent" },
  ];

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Heute";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Gestern";
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  };

  return (
    <div className="container py-4 animate-slide-up">
      {/* Hero, v3 — centered again (closer to the original feel), but the club name/tagline
          text is dropped entirely: the top nav bar already shows "H-Town United e.V." right
          above this, so repeating it here just looked like a duplicate banner. What's left is
          the one thing that IS unique to this spot — the club emblem + motto — kept compact
          so the quick-access cards below stay reachable without scrolling. */}
      <div className="gradient-hero rounded-2xl p-5 sm:p-6 mb-4 border border-border relative overflow-hidden text-center">
        <img
          src={htuLogo}
          alt=""
          aria-hidden
          className="absolute -right-14 -top-14 w-64 h-64 object-contain opacity-[0.06] pointer-events-none select-none mix-blend-screen"
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(185_85%_48%/0.1),transparent_65%)]" />
        <div className="relative flex flex-col items-center">
          <div className="relative mb-3 group">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl scale-125" />
            <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-background/40 border-2 border-primary/40 glow-cyan flex items-center justify-center p-2.5 transition-transform duration-700 group-hover:rotate-[8deg]">
              <img
                src={htuEmblem}
                alt="H-Town United e.V. Vereinsemblem"
                className="w-full h-full object-contain"
              />
            </div>
          </div>
          <p className="font-graffiti text-xl sm:text-2xl leading-tight -rotate-1 select-none text-primary drop-shadow-[0_0_14px_hsl(185_85%_48%/0.45)]">
            Von Heiligenhausern, für Heiligenhaus
          </p>
          <p className="text-[10px] sm:text-xs uppercase tracking-[0.35em] text-muted-foreground font-display mt-2">
            Darts · Verein · Gemeinschaft
          </p>
        </div>
      </div>

      {/* Statistics overview */}
      <div className="grid grid-cols-3 gap-3 mb-5">
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
          <Link key={action.to} to={action.to}
            className="bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-all group">
            <action.icon className="w-6 h-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
            <p className="font-semibold text-sm">{action.label}</p>
            <p className="text-xs text-muted-foreground">{action.desc}</p>
          </Link>
        ))}
      </div>

      {/* Recent games feed */}
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-3">Letzte Spiele</h2>
      {recentGames.length === 0 ? (
        <Link to="/game" className="block bg-card border border-border hover:border-primary/40 rounded-xl px-4 py-6 text-center text-sm text-muted-foreground transition-colors">
          Noch keine Spiele gespielt. <span className="text-primary font-medium">Starte dein erstes Spiel!</span>
        </Link>
      ) : (
        <div className="space-y-2">
          {recentGames.map((game) => (
            <div key={game.id} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs bg-muted px-2 py-0.5 rounded-md font-mono">{game.mode}</span>
                <span className="text-sm">
                  {game.player1_name} <span className="text-muted-foreground">vs</span> {game.player2_name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{formatDate(game.played_at)}</span>
                <span className="text-xs text-secondary font-medium">{game.winner_name} ✓</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
