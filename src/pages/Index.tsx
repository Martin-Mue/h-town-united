import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Target, Users, Trophy, Medal, Dumbbell, BarChart3, Flame, TrendingUp, Crosshair, Loader2, PartyPopper } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchClubPlayers } from "@/lib/repositories/players";
import { computeClubActivity, type ActivityEvent, type ActivityLegRow, type ActivityTranslator } from "@/utils/clubActivity";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { LOCALE_BY_LANGUAGE } from "@/i18n/translations";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";
import { Badge } from "@/components/ui/badge";
import htuEmblem from "@/assets/club-emblem-color.png";
import PendingOnlineChallenges from "@/components/home/PendingOnlineChallenges";

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
  /** Every real participant's name, in player_index order — only set when a game had more than
   *  2 players (a free-for-all), since player1_name/player2_name (whoever ranked top-2) already
   *  covers the plain 1v1 case exactly. */
  participantNames?: string[];
}

interface AnniversaryEntry {
  id: string;
  name: string;
  years: number;
}

const DashboardPage = () => {
  const { language, t } = useLanguage();
  const { club, name: clubName, tagline, logoUrl } = useClubBranding();
  // Until a club uploads its own logo, the hero watermark keeps its ORIGINAL bundled artwork
  // (a different image from the circular badge below it) so the page stays pixel-identical to
  // today — only once logo_path is set does it switch to the one uploaded image.
  const watermarkSrc = club?.logo_path ? logoUrl : htuEmblem;
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [anniversaries, setAnniversaries] = useState<AnniversaryEntry[]>([]);
  const [expandedGames, setExpandedGames] = useState<Set<string>>(new Set());
  const pagedRecentGames = usePagedList(recentGames);
  const pagedActivity = usePagedList(activity);

  useEffect(() => {
    // Guards both fetches below against a fast repeated language switch: two overlapping
    // effect runs could otherwise resolve out of order and the STALE one (built with the
    // previous language's translator, in loadActivity's case) could land last and overwrite
    // the fresher one.
    let cancelled = false;
    const load = async () => {
      setLoadingGames(true);
      // Just the 5 actually shown by default (usePagedList's own collapseAt) — this widget isn't
      // meant to be paginated/expanded like the app's other long lists, so there's no reason to
      // pull 100 rows (and 100 games' worth of legs below) just to let them pile up unused.
      const { data } = await supabase
        .from("games")
        .select("id, mode, player1_name, player2_name, winner_name, played_at")
        .order("played_at", { ascending: false })
        .limit(5);
      if (cancelled) return;
      if (data) setRecentGames(data);
      setLoadingGames(false);

      // player1_name/player2_name only ever cover the top-2 finishers (see gameSync.ts's
      // `ranking`) — for a free-for-all with more real players than that, this second pass
      // pulls every participant's name from game_legs and attaches the full list, so the feed
      // can reveal who else actually played instead of silently dropping them.
      if (data && data.length > 0) {
        const { data: legs } = await supabase
          .from("game_legs")
          .select("game_id, player_index, player_name")
          .in("game_id", data.map((g) => g.id));
        if (cancelled || !legs) return;
        const namesByGame = new Map<string, Map<number, string>>();
        legs.forEach((l) => {
          const byIndex = namesByGame.get(l.game_id) ?? new Map<number, string>();
          byIndex.set(l.player_index, l.player_name);
          namesByGame.set(l.game_id, byIndex);
        });
        setRecentGames((prev) => prev.map((g) => {
          const byIndex = namesByGame.get(g.id);
          if (!byIndex || byIndex.size <= 2) return g;
          const participantNames = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, name]) => name);
          return { ...g, participantNames };
        }));
      }
    };
    load();

    // Club activity feed: processes the whole game/leg history chronologically (to track each
    // player's real personal bests correctly) but only ever DISPLAYS the recent window — see
    // computeClubActivity's own doc comment. Small club, small data (tens of games/legs total),
    // so fetching everything here is simpler and fast enough rather than a windowed query.
    // `detail` strings come back already formatted in the active language (see the translator
    // built below) — re-running this on a language change is what keeps them in sync; there's no
    // separate re-render path for text baked into already-fetched state like this.
    const translator: ActivityTranslator = {
      oneEighty: (count) => (count > 1 ? `${count}${t("activity.oneEightyMulti")}` : t("activity.oneEighty")),
      newAverageRecord: (avg) => `${t("activity.newAverageRecord")} ${avg}`,
      newBestFinish: (checkout) => `${t("activity.newBestFinish")} ${checkout}`,
      winStreak: (streak) => `${streak} ${t("activity.winStreak")}`,
    };
    const loadActivity = async () => {
      const [{ data: games }, { data: legs }] = await Promise.all([
        supabase.from("games").select("id, mode, player1_id, player2_id, player1_name, player2_name, player1_average, player2_average, winner_id, played_at"),
        supabase.from("game_legs").select("game_id, leg_number, player_id, player_name, throws, starting_score, won"),
      ]);
      if (cancelled) return;
      if (games && legs) {
        setActivity(computeClubActivity(games, legs as unknown as ActivityLegRow[], 14, translator));
      }
    };
    loadActivity();

    // Membership anniversaries: joined_year is a manually-entered YEAR only (no day/month), so
    // this can only ever say "N years with the club this year", never pinpoint the exact day —
    // every full year counts (not just round 5/10-year milestones), matching how the feature was
    // requested. Deliberately its own section rather than folded into computeClubActivity above:
    // it isn't derived from games/legs and has no natural played-at recency window to sit inside.
    const loadAnniversaries = async () => {
      const roster = await fetchClubPlayers();
      if (cancelled) return;
      const currentYear = new Date().getFullYear();
      setAnniversaries(
        roster
          .filter((p): p is typeof p & { joined_year: number } => !!p.joined_year && currentYear - p.joined_year > 0)
          .map((p) => ({ id: p.id, name: p.name, years: currentYear - p.joined_year }))
          .sort((a, b) => b.years - a.years || a.name.localeCompare(b.name))
      );
    };
    loadAnniversaries();
    return () => { cancelled = true; };
    // `language` (not `t`) is the real dependency — `t` is a fresh closure every render (see
    // LanguageContext), so listing it would refetch on every render instead of only when the
    // language actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return t("home.today");
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return t("home.yesterday");
    return d.toLocaleDateString(LOCALE_BY_LANGUAGE[language], { day: "2-digit", month: "2-digit" });
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
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.1),transparent_65%)]" />
        <div className="relative flex flex-col items-center">
          <div className="relative mb-2 h-[196px] sm:h-[220px] w-full">
            <img
              src={watermarkSrc}
              alt={t("players.clubEmblemAlt")}
              className="absolute top-0 left-1/2 -translate-x-1/2 w-[180px] h-[180px] sm:w-[200px] sm:h-[200px] object-contain opacity-40 saturate-[0.65] pointer-events-none select-none"
            />
            <div className="absolute left-1/2 -translate-x-1/2 top-[104px] sm:top-[115px] group">
              <div className="absolute inset-0 rounded-full bg-primary/25 blur-xl scale-125" />
              <div className="relative w-[92px] h-[92px] sm:w-[102px] sm:h-[102px] rounded-full border-2 border-primary/60 glow-cyan overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-transform duration-700 group-hover:-rotate-[6deg]">
                <img
                  src={logoUrl}
                  alt={clubName}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
          {/* Optional per-club tagline (DB column, nullable) — this club's is a wordplay on its
              town name (Heiligenhaus), deliberately not translated since an English rendering
              would just lose the point of it. Rendered only when a club has set one. */}
          {tagline && (
            <p className="font-graffiti text-xl sm:text-2xl leading-tight -rotate-1 select-none text-primary drop-shadow-[0_0_14px_hsl(var(--primary)/0.45)]">
              {tagline}
            </p>
          )}
          <p className="text-[10px] sm:text-xs uppercase tracking-[0.35em] text-muted-foreground font-display mt-2">
            {t("home.tagline")}
          </p>
        </div>
      </div>

      <PendingOnlineChallenges />

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

      {/* Membership anniversaries — only shown once there's at least one to celebrate. */}
      {anniversaries.length > 0 && (
        <>
          <h2 className="font-display uppercase text-sm text-muted-foreground mb-3 flex items-center gap-1.5">
            <PartyPopper className="w-3.5 h-3.5 text-accent" /> {t("home.anniversaryHeading")}
          </h2>
          <div className="space-y-2 mb-6">
            {anniversaries.map((a) => (
              <div key={a.id} className="bg-card border border-border rounded-xl px-4 py-2.5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
                  <PartyPopper className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">
                    <span className="font-semibold">{a.name}</span> ·{" "}
                    {a.years === 1 ? t("home.anniversaryOneYear") : `${a.years} ${t("home.anniversaryYearsSuffix")}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Recent games feed */}
      <h2 className="font-display uppercase text-sm text-muted-foreground mb-3">{t("home.recentGames")}</h2>
      {loadingGames ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : recentGames.length === 0 ? (
        <Link to="/game" className="block bg-card border border-border hover:border-primary/40 rounded-xl px-4 py-6 text-center text-sm text-muted-foreground transition-colors">
          {t("home.noGamesYet")} <span className="text-primary font-medium">{t("home.startFirstGame")}</span>
        </Link>
      ) : (
        <div className="space-y-2">
          {pagedRecentGames.visible.map((game) => {
            const extra = game.participantNames && game.participantNames.length > 2 ? game.participantNames : null;
            const isExpanded = extra ? expandedGames.has(game.id) : false;
            return (
              <div key={game.id} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Badge variant="outline" className="text-xs bg-muted px-2 py-0.5 font-mono border-transparent shrink-0">{game.mode}</Badge>
                  {isExpanded && extra ? (
                    <span className="text-sm min-w-0 truncate">{extra.join(", ")}</span>
                  ) : (
                    <span className="text-sm min-w-0 truncate">
                      {game.player1_name} <span className="text-muted-foreground">vs</span> {game.player2_name}
                    </span>
                  )}
                  {extra && (
                    <button
                      type="button"
                      onClick={() => setExpandedGames((prev) => {
                        const next = new Set(prev);
                        if (next.has(game.id)) next.delete(game.id); else next.add(game.id);
                        return next;
                      })}
                      title={isExpanded ? t("common.showLess") : t("common.showMore")}
                      aria-label={isExpanded ? t("common.showLess") : `${t("common.showMore")} (+${extra.length - 2})`}
                      className="shrink-0 text-xs font-mono text-primary hover:underline"
                    >
                      {isExpanded ? "−" : `+${extra.length - 2}`}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">{formatDate(game.played_at)}</span>
                  <span className="text-xs text-secondary font-medium">{game.winner_name} ✓</span>
                </div>
              </div>
            );
          })}
          <ListPaginationFooter list={pagedRecentGames} />
        </div>
      )}

      {/* Lets a returning visitor check what's actually installed on their device against the
          repo — the service worker (see main.tsx) already force-checks for updates every time
          the app comes back to the foreground and auto-reloads once a newer one takes over, but
          this gives a way to *confirm* that happened instead of just trusting it silently did. */}
      <p className="mt-6 text-center text-[10px] text-muted-foreground/60">
        Build {__APP_VERSION__} · {new Date(__BUILD_TIME__).toLocaleString(LOCALE_BY_LANGUAGE[language], { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
};

export default DashboardPage;
