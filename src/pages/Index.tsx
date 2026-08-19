import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Target, Users, Trophy, Medal, Dumbbell, BarChart3, Flame, TrendingUp, Crosshair } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { computeClubActivity, type ActivityEvent, type ActivityLegRow } from "@/utils/clubActivity";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";
import htuLogo from "@/assets/htu-logo.jpg";
import htuEmblem from "@/assets/club-emblem-color.png";

const EVENT_ICON: Record<ActivityEvent["type"], typeof Target> = {
  "180": Target,
  pb_average: TrendingUp,
  pb_checkout: Crosshair,
  win_streak: Flame,
};

const QUICK_ACTIONS = [
  { to: "/game", labelKey: "home.newGame", descKey: "home.newGameDesc", icon: Target },
  { to: "/tournament", labelKey: "home.tournament", descKey: "home.tournamentDesc", icon: Trophy },
  { to: "/tournaments/series", labelKey: "home.season", descKey: "home.seasonDesc", icon: Medal },
  { to: "/statistics", labelKey: "home.statistics", descKey: "home.statisticsDesc", icon: BarChart3 },
  { to: "/training", labelKey: "home.training", descKey: "home.trainingDesc", icon: Dumbbell },
  { to: "/players", labelKey: "home.club", descKey: "home.clubDesc", icon: Users },
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
  const { language, t } = useLanguage();
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const pagedRecentGames = usePagedList(recentGames);
  const pagedActivity = usePagedList(activity);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("games")
        .select("id, mode, player1_name, player2_name, winner_name, played_at")
        .order("played_at", { ascending: false })
        .limit(100);
      if (data) setRecentGames(data);
    };
    load();

    // Club activity feed: processes the whole game/leg history chronologically (to track each
    // player's real personal bests correctly) but only ever DISPLAYS the recent window — see
    // computeClubActivity's own doc comment. Small club, small data (tens of games/legs total),
    // so fetching everything here is simpler and fast enough rather than a windowed query.
    const loadActivity = async () => {
      const [{ data: games }, { data: legs }] = await Promise.all([
        supabase.from("games").select("id, player1_id, player2_id, player1_name, player2_name, player1_average, player2_average, winner_id, played_at"),
        supabase.from("game_legs").select("game_id, player_id, player_name, throws, starting_score, won"),
      ]);
      if (games && legs) {
        setActivity(computeClubActivity(games, legs as unknown as ActivityLegRow[], 14));
      }
    };
    loadActivity();
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return t("home.today");
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return t("home.yesterday");
    return d.toLocaleDateString(language === "en" ? "en-US" : "de-DE", { day: "2-digit", month: "2-digit" });
  };

  return (
    <div className="container py-4 animate-slide-up">
      {/* Hero, v6 — "grown from the root": the club tree emblem sits large and muted up top
          with its full canopy visible (that's the recognizable shape — a smaller/blurrier tree
          read as unrecognizable in earlier passes), and the Darts badge — sharp, saturated —
          overlaps only the tree's lower trunk area, like it grew out of it. Picked over a
          concentric layering (badge centered over the tree) specifically because that hid too
          much of the tree behind the badge to read as a tree at all. */}
      <div className="gradient-hero rounded-2xl p-5 sm:p-6 pt-8 mb-4 border border-border relative overflow-hidden text-center">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(185_85%_48%/0.1),transparent_65%)]" />
        <div className="relative flex flex-col items-center">
          <div className="relative mb-2 h-[196px] sm:h-[220px] w-full">
            <img
              src={htuEmblem}
              alt="H-Town United e.V. Vereinsemblem"
              className="absolute top-0 left-1/2 -translate-x-1/2 w-[180px] h-[180px] sm:w-[200px] sm:h-[200px] object-contain opacity-40 saturate-[0.65] pointer-events-none select-none"
            />
            <div className="absolute left-1/2 -translate-x-1/2 top-[104px] sm:top-[115px] group">
              <div className="absolute inset-0 rounded-full bg-primary/25 blur-xl scale-125" />
              <div className="relative w-[92px] h-[92px] sm:w-[102px] sm:h-[102px] rounded-full border-2 border-primary/60 glow-cyan overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-transform duration-700 group-hover:-rotate-[6deg]">
                <img
                  src={htuLogo}
                  alt="H-Town United Darts Vereinswappen"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
          {/* Deliberately not translated — it's a wordplay on the town name (Heiligenhaus),
              not descriptive copy; an English rendering would just lose the point of it. */}
          <p className="font-graffiti text-xl sm:text-2xl leading-tight -rotate-1 select-none text-primary drop-shadow-[0_0_14px_hsl(185_85%_48%/0.45)]">
            Von Heiligenhausern, für Heiligenhaus
          </p>
          <p className="text-[10px] sm:text-xs uppercase tracking-[0.35em] text-muted-foreground font-display mt-2">
            {t("home.tagline")}
          </p>
        </div>
      </div>

      {/* Quick action cards */}
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-3">{t("home.quickAccess")}</h2>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {QUICK_ACTIONS.map((action) => (
          <Link key={action.to} to={action.to}
            className="bg-card border border-border rounded-xl p-4 hover:border-primary/40 transition-all group">
            <action.icon className="w-6 h-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
            <p className="font-semibold text-sm">{t(action.labelKey)}</p>
            <p className="text-xs text-muted-foreground">{t(action.descKey)}</p>
          </Link>
        ))}
      </div>

      {/* Club activity feed — notable moments (180s, personal bests, win streaks) from the last
          14 days, derived from data that already exists (see clubActivity.ts). Only shown once
          there's something to show — an empty feed would just be noise between the quick
          actions and the always-present recent-games list below. */}
      {activity.length > 0 && (
        <>
          <h2 className="font-display uppercase text-sm text-muted-foreground mb-3 flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-accent" /> {t("home.whatsHappening")}
          </h2>
          <div className="space-y-2 mb-2">
            {pagedActivity.visible.map((e) => {
              const Icon = EVENT_ICON[e.type];
              return (
                <div key={e.id} className="bg-card border border-border rounded-xl px-4 py-2.5 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate"><span className="font-semibold">{e.playerName}</span> · {e.detail}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{formatDate(e.playedAt)}</span>
                </div>
              );
            })}
          </div>
          <div className="mb-6"><ListPaginationFooter list={pagedActivity} /></div>
        </>
      )}

      {/* Recent games feed */}
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-3">{t("home.recentGames")}</h2>
      {recentGames.length === 0 ? (
        <Link to="/game" className="block bg-card border border-border hover:border-primary/40 rounded-xl px-4 py-6 text-center text-sm text-muted-foreground transition-colors">
          {t("home.noGamesYet")} <span className="text-primary font-medium">{t("home.startFirstGame")}</span>
        </Link>
      ) : (
        <div className="space-y-2">
          {pagedRecentGames.visible.map((game) => (
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
          <ListPaginationFooter list={pagedRecentGames} />
        </div>
      )}

      {/* Lets a returning visitor check what's actually installed on their device against the
          repo — the service worker (see main.tsx) already force-checks for updates every time
          the app comes back to the foreground and auto-reloads once a newer one takes over, but
          this gives a way to *confirm* that happened instead of just trusting it silently did. */}
      <p className="mt-6 text-center text-[10px] text-muted-foreground/60">
        Build {__APP_VERSION__} · {new Date(__BUILD_TIME__).toLocaleString(language === "en" ? "en-US" : "de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
};

export default DashboardPage;
