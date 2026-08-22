import { useEffect, useState } from "react";
import { X, Share2, Trophy, Target, TrendingUp, Flame, Crosshair, Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { shareOrDownloadSeasonRecap } from "@/utils/seasonRecapImage";
import type { HighlightClipRecord } from "@/pages/Statistics";
import { useLanguage } from "@/contexts/LanguageContext";
import { highlightKindLabel } from "@/utils/x01Rules";

export interface SeasonRecapData {
  player: { id: string; name: string; emoji: string; elo_rating?: number };
  periodLabel: string;
  games: number;
  wins: number;
  winRate: number;
  total180s: number;
  bestCheckout: number;
  checkoutPercentage: number;
  bestGameAvg: number;
  bestStreak: number;
  elo: number;
  clips: HighlightClipRecord[];
}

interface SeasonRecapProps {
  recap: SeasonRecapData;
  onClose: () => void;
}

/** Full-screen "Saison-Rückblick" — a Spotify-Wrapped-style sequence of headline stat cards
 *  followed by this player's best highlight clips from the period, plus a one-tap share of a
 *  condensed summary image (see seasonRecapImage.ts). Deliberately a scrollable page, not a
 *  timed/swipe-gesture story format — same visual "reveal" feeling, but nothing that depends on
 *  gesture or timing behavior no camera-less environment could ever verify actually feels right. */
const SeasonRecap = ({ recap, onClose }: SeasonRecapProps) => {
  const { t } = useLanguage();
  const [clipUrls, setClipUrls] = useState<Record<string, string>>({});
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (recap.clips.length === 0) return;
    let cancelled = false;
    supabase.storage.from("dart-clips").createSignedUrls(recap.clips.map((c) => c.storage_path), 3600).then(({ data }) => {
      if (cancelled || !data) return;
      const map: Record<string, string> = {};
      data.forEach((d) => { if (d.signedUrl && d.path) map[d.path] = d.signedUrl; });
      setClipUrls(map);
    });
    return () => { cancelled = true; };
  }, [recap.clips]);

  const handleShare = async () => {
    setSharing(true);
    try {
      await shareOrDownloadSeasonRecap(
        {
          clubName: "H-Town United",
          playerName: recap.player.name,
          emoji: recap.player.emoji,
          periodLabel: recap.periodLabel,
          games: recap.games,
          wins: recap.wins,
          winRate: recap.winRate,
          bestGameAvg: recap.bestGameAvg,
          total180s: recap.total180s,
          bestCheckout: recap.bestCheckout,
          bestStreak: recap.bestStreak,
          elo: recap.elo,
        },
        `saison-rueckblick-${recap.player.name.toLowerCase().replace(/\s+/g, "-")}.png`
      );
    } finally {
      setSharing(false);
    }
  };

  const statCards = [
    { icon: Trophy, label: t("recap.gamesAndWins"), value: `${recap.wins} / ${recap.games}`, sub: `${recap.winRate}% ${t("recap.winRateSuffix")}`, color: "text-primary" },
    { icon: TrendingUp, label: t("recap.bestGame"), value: recap.bestGameAvg.toFixed(1), sub: "Average", color: "text-secondary" },
    { icon: Target, label: t("recap.oneEightiesThrown"), value: String(recap.total180s), sub: recap.total180s > 0 ? "🎯".repeat(Math.min(recap.total180s, 5)) : t("recap.noneYetNextTime"), color: "text-accent" },
    { icon: Crosshair, label: t("recap.bestFinish"), value: recap.bestCheckout > 0 ? String(recap.bestCheckout) : "–", sub: recap.checkoutPercentage > 0 ? `${recap.checkoutPercentage.toFixed(0)}% ${t("recap.checkoutRateSuffix")}` : "", color: "text-destructive" },
    { icon: Flame, label: t("recap.bestWinStreak"), value: `${recap.bestStreak}×`, sub: t("recap.inARow"), color: "text-orange-400" },
    { icon: Award, label: t("recap.eloRating"), value: String(recap.elo), sub: t("recap.current"), color: "text-primary" },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto animate-slide-up">
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-background/95 backdrop-blur border-b border-border/40">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{recap.player.emoji}</span>
          <div>
            <p className="font-display text-sm uppercase leading-tight">{recap.player.name}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{recap.periodLabel}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("game.close")}><X className="w-5 h-5" /></Button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {statCards.map((s, i) => (
            <div
              key={s.label}
              className="bg-card border border-border rounded-xl p-4 text-center animate-scale-in"
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: "backwards" }}
            >
              <s.icon className={`w-5 h-5 mx-auto mb-2 ${s.color}`} />
              <p className={`text-2xl font-display ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase mt-0.5">{s.label}</p>
              {s.sub && <p className="text-[10px] text-muted-foreground mt-1">{s.sub}</p>}
            </div>
          ))}
        </div>

        {recap.clips.length > 0 && (
          <div>
            <h3 className="font-display text-sm uppercase text-muted-foreground mb-2 mt-6">{t("recap.yourHighlights")}</h3>
            <div className="space-y-3">
              {recap.clips.map((clip, i) => (
                <div key={clip.id} className="bg-card border border-border rounded-xl overflow-hidden animate-scale-in" style={{ animationDelay: `${(statCards.length + i) * 60}ms`, animationFillMode: "backwards" }}>
                  {clipUrls[clip.storage_path] ? (
                    <video src={clipUrls[clip.storage_path]} controls playsInline className="w-full aspect-video bg-black" preload="metadata" />
                  ) : (
                    <div className="w-full aspect-video bg-muted animate-pulse" />
                  )}
                  <div className="p-2.5 flex items-center justify-between text-xs">
                    <Badge variant="outline" className="bg-accent/15 text-accent px-2 py-0.5 text-[10px] border-transparent">{highlightKindLabel(clip.kind, undefined, t("game.points"))}</Badge>
                    <span className="text-muted-foreground">{clip.points} {t("game.points")}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {recap.games === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">
            {t("recap.noGamesInPeriod")}
          </p>
        )}

        <Button onClick={handleShare} disabled={sharing} className="w-full gap-2 mt-4">
          <Share2 className="w-4 h-4" /> {sharing ? t("recap.creatingImage") : t("recap.shareAsImage")}
        </Button>
      </div>
    </div>
  );
};

export default SeasonRecap;
