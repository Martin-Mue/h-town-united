import { useEffect, useMemo, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { Link } from "react-router-dom";
import { Flame, TrendingUp, Crosshair, PartyPopper, Swords } from "lucide-react";
import { DartGameIcon, DartTrophyIcon, SeasonIcon, StatsIcon, TrainingIcon, ClubIcon, DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { supabase } from "@/integrations/supabase/client";
import { usePlayers } from "@/hooks/usePlayers";
import { computeClubActivity, type ActivityEvent, type ActivityLegRow, type ActivityTranslator } from "@/utils/clubActivity";
import { useLanguage } from "@/contexts/LanguageContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { LOCALE_BY_LANGUAGE } from "@/i18n/translations";
import { usePagedList } from "@/hooks/usePagedList";
import { ListPaginationFooter } from "@/components/ui/list-pagination-footer";
import { Badge } from "@/components/ui/badge";
import PendingOnlineChallenges from "@/components/home/PendingOnlineChallenges";
import PendingDoublesLobbies from "@/components/home/PendingDoublesLobbies";
import LiveOnlineMatches from "@/components/home/LiveOnlineMatches";
import PendingOnlineDuels from "@/components/home/PendingOnlineDuels";
import OnlineNowStrip from "@/components/home/OnlineNowStrip";
import OpenGameCard from "@/components/home/OpenGameCard";
import TournamentRows, { type LiveTournamentInfo } from "@/components/home/TournamentRows";
import FormTiles, { type MyForm } from "@/components/home/FormTiles";
import { useAuth } from "@/contexts/AuthContext";
import { loadActiveGameSnapshot } from "@/lib/activeGameSnapshot";
import { describeResumableGame, findNextTournamentMatch, type TournamentLite } from "@/utils/homeHighlights";

// Icon type shared by lucide's components and DartSpot's own hand-drawn set (DartIcons.tsx) —
// both accept plain SVGProps and get called the same way (<Icon className="..." />), so this
// dashboard mixes both freely: DartIcons where a direct dart-domain equivalent exists (Game,
// Tournament, Season, Statistics, Training, Club), lucide kept where the concept is a generic,
// non-dart-specific glyph (a trend arrow, a flame, a crosshair) rather than a stand-in for one of
// this set's six nav concepts — see the roadmap's Design-Sprint item for that scoping.
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const EVENT_ICON: Record<ActivityEvent["type"], IconComponent> = {
  "180": DartGameIcon,
  pb_average: TrendingUp,
  pb_checkout: Crosshair,
  win_streak: Flame,
  match_result: DartTrophyIcon,
};

// Redesign 2026-11: the six big tiles became compact link buttons. All areas are listed (also the
// ones in the bottom bar) — members look for "Turnier" here, and Liga has no other shortcut.
const AREA_LINKS: { to: string; labelKey: string; icon: IconComponent }[] = [
  { to: "/tournament", labelKey: "home.tournament", icon: DartTrophyIcon },
  { to: "/leagues", labelKey: "tournament.leagueMode", icon: Swords },
  { to: "/tournaments/series", labelKey: "home.season", icon: SeasonIcon },
  { to: "/training", labelKey: "home.training", icon: TrainingIcon },
  { to: "/party", labelKey: "home.party", icon: PartyPopper },
  { to: "/statistics", labelKey: "home.statistics", icon: StatsIcon },
  { to: "/players", labelKey: "home.club", icon: ClubIcon },
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
  const { name: clubName, tagline } = useClubBranding();
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [expandedGames, setExpandedGames] = useState<Set<string>>(new Set());
  const pagedRecentGames = usePagedList(recentGames);
  const pagedActivity = usePagedList(activity);

  // Round 3 Rang 4: shared/cached club roster (usePlayers) instead of this page's own
  // fetchClubPlayers() mount fetch — see usePlayers.ts. Membership anniversaries (below) are now a
  // pure derivation of the roster (no separate loading/async step needed), recomputed whenever the
  // cached roster changes.
  const { data: roster = [] } = usePlayers();
  const { user } = useAuth();
  const myPlayer = roster.find((p) => p.user_id === user?.id);
  // "Für dich": a saved unfinished game, running tournaments and the player's own next match / numbers.
  const resume = useMemo(() => describeResumableGame(loadActiveGameSnapshot()?.game), []);
  const [runningTournaments, setRunningTournaments] = useState<TournamentLite[]>([]);
  useEffect(() => {
    let cancelled = false;
    supabase.from("tournaments").select("id, name, mode, status, bracket, public_view, public_slug").eq("status", "active").then(({ data }) => {
      if (!cancelled && data) setRunningTournaments(data as TournamentLite[]);
    });
    return () => { cancelled = true; };
  }, []);
  const liveTournaments: LiveTournamentInfo[] = runningTournaments.slice(0, 2).map((x) => ({ id: x.id, name: x.name }));
  const nextMatch = useMemo(() => findNextTournamentMatch(runningTournaments, myPlayer?.name ?? ""), [runningTournaments, myPlayer?.name]);
  const eloRank = useMemo(() => {
    if (!myPlayer) return null;
    const ranked = roster.filter((p) => p.games_played > 0).sort((a, b) => b.elo_rating - a.elo_rating);
    const index = ranked.findIndex((p) => p.id === myPlayer.id);
    return index >= 0 ? index + 1 : null;
  }, [roster, myPlayer]);
  const myForm: MyForm | null = myPlayer && myPlayer.games_played > 0
    ? { average: myPlayer.average, checkoutRate: Number(myPlayer.double_rate) || 0, elo: myPlayer.elo_rating, eloRank, wins: myPlayer.games_won, played: myPlayer.games_played, highScore: myPlayer.high_score }
    : null;
  const firstName = myPlayer?.name.split(" ")[0] ?? "";
  // Membership anniversaries: joined_year is a manually-entered YEAR only (no day/month), so this
  // can only ever say "N years with the club this year", never pinpoint the exact day — every full
  // year counts (not just round 5/10-year milestones), matching how the feature was requested.
  // Deliberately its own derivation rather than folded into computeClubActivity below: it isn't
  // derived from games/legs and has no natural played-at recency window to sit inside.
  const anniversaries: AnniversaryEntry[] = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return roster
      .filter((p): p is typeof p & { joined_year: number } => !!p.joined_year && currentYear - p.joined_year > 0)
      .map((p) => ({ id: p.id, name: p.name, years: currentYear - p.joined_year }))
      .sort((a, b) => b.years - a.years || a.name.localeCompare(b.name));
  }, [roster]);

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
      matchResult: (opponent) => t("activity.matchResultTemplate").replace("{opponent}", opponent),
      matchResultMultiplayer: (count) => t("activity.matchResultMultiplayerTemplate").replace("{count}", String(count)),
    };
    const loadActivity = async () => {
      const [{ data: games }, { data: legs }] = await Promise.all([
        // winner_name + detail_stats added for computeClubActivity's team-game branch (Round 3
        // Community-Audit KORREKTUR) -- without them it can't tell a 2v2 apart from a
        // free-for-all and silently drops/mislabels team wins in the feed.
        supabase.from("games").select("id, mode, player1_id, player2_id, player1_name, player2_name, player1_average, player2_average, winner_id, winner_name, detail_stats, played_at"),
        supabase.from("game_legs").select("game_id, leg_number, player_id, player_name, throws, starting_score, won"),
      ]);
      if (cancelled) return;
      if (games && legs) {
        setActivity(computeClubActivity(games, legs as unknown as ActivityLegRow[], 14, translator));
      }
    };
    loadActivity();
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

  const hasFeed = activity.length > 0 || anniversaries.length > 0;

  return (
    <div className="container max-w-6xl py-4 animate-slide-up">
      {/* Redesign 2026-11 (canvas "Start"): no big crest hero any more — greeting, then the open
          game, the member's own tournament match and form, who is online, and the club feed. */}
      <header className="mb-4">
        <h1 className="font-display font-bold text-[28px] leading-tight">
          {firstName ? t("home.greeting").replace("{name}", firstName) : clubName}
        </h1>
        {/* The club motto keeps its own voice (graffiti font, club color, slight tilt) — members
            asked for it back after the redesign shrank it to a grey label. Not translated: it is
            the club's own wording. */}
        {tagline && (
          <p className="mt-1 font-graffiti text-lg sm:text-2xl leading-tight -rotate-1 origin-left select-none text-primary">
            {tagline}
          </p>
        )}
      </header>

      <div className="lg:grid lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-8 lg:items-start">
      <div className="min-w-0 flex flex-col gap-3.5 mb-6">
        <OpenGameCard resume={resume} />
        <TournamentRows next={nextMatch} live={liveTournaments} />
        {myForm && <FormTiles form={myForm} />}
        <OnlineNowStrip />
        <PendingOnlineChallenges />
        <PendingDoublesLobbies />
        <PendingOnlineDuels />
        <LiveOnlineMatches />
        <nav aria-label={t("nav.more")} className="grid grid-cols-3 gap-2">
          {AREA_LINKS.map((area) => (
            <Link
              key={area.to}
              to={area.to}
              className="min-w-0 h-11 px-2 rounded-xl border border-border bg-card flex items-center justify-center gap-1.5 text-sm font-medium active:scale-95 transition-transform"
            >
              <area.icon className="w-4 h-4 shrink-0 text-primary" />
              <span className="truncate">{t(area.labelKey)}</span>
            </Link>
          ))}
        </nav>
      </div>

      <div className="min-w-0">
      {/* Club activity feed — notable moments (180s, personal bests, win streaks) from the last
          14 days, derived from data that already exists (see clubActivity.ts). Only shown once
          there's something to show — an empty feed would just be noise between the quick
          actions and the always-present recent-games list below. */}
      {/* Right column on wide screens, below everything on a phone: feed, anniversaries, recent games. */}
      <div>
      {hasFeed && <div className="min-w-0">
      {activity.length > 0 && (
        <>
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2 flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-accent" /> {t("home.inClub")}
          </h2>
          <div className="space-y-2 mb-2">
            {pagedActivity.visible.map((e) => {
              const Icon = EVENT_ICON[e.type];
              return (
                <div key={e.id} className="bg-card border border-border rounded-[14px] px-3.5 py-2.5 flex items-center gap-3">
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
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2 flex items-center gap-1.5">
            <PartyPopper className="w-3.5 h-3.5 text-accent" /> {t("home.anniversaryHeading")}
          </h2>
          <div className="space-y-2 mb-6">
            {anniversaries.map((a) => (
              <div key={a.id} className="bg-card border border-border rounded-[14px] px-3.5 py-2.5 flex items-center gap-3">
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
      </div>}

      <div className="min-w-0">
      {/* Recent games feed */}
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">{t("home.recentGames")}</h2>
      {loadingGames ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : recentGames.length === 0 ? (
        <Link to="/game" className="block bg-card border border-border hover:border-primary/40 active:scale-[0.98] active:border-primary/40 rounded-xl px-4 py-6 text-center text-sm text-muted-foreground transition-all" style={{ transitionTimingFunction: "var(--ease-press)" }}>
          {/* Design Rangliste #15: this was plain text before — reuses DartGameIcon (the same
              hand-drawn dart-in-flight icon as the "Neues Spiel" quick action right above) rather
              than a generic lucide glyph, so the very first impression on an empty dashboard
              already speaks this app's own icon language instead of falling back to stock text. */}
          <DartGameIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
          {t("home.noGamesYet")} <span className="text-primary font-medium">{t("home.startFirstGame")}</span>
        </Link>
      ) : (
        <div className="space-y-2">
          {pagedRecentGames.visible.map((game) => {
            const extra = game.participantNames && game.participantNames.length > 2 ? game.participantNames : null;
            const isExpanded = extra ? expandedGames.has(game.id) : false;
            return (
              <div key={game.id} className="bg-card border border-border rounded-[14px] px-3.5 py-3 flex items-center justify-between gap-3">
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
      </div>
      </div>
      </div>
      </div>

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
