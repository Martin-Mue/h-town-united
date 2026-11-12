import { Pencil, Play, Wifi } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface LeagueFixtureActionsProps {
  resultMode: "live" | "manual";
  /** The next open fixture of the league gets the one filled (primary) button of the screen. */
  isNextUp: boolean;
  /** Both players have linked accounts and the viewer is one of them. */
  canPlayOnline: boolean;
  startingOnline: boolean;
  onPlay: () => void;
  onPlayOnline: () => void;
  onEnterResult: () => void;
}

/** Buttons under an open fixture: play here / play online for a live league, enter the result for a manual one. */
const LeagueFixtureActions = ({ resultMode, isNextUp, canPlayOnline, startingOnline, onPlay, onPlayOnline, onEnterResult }: LeagueFixtureActionsProps) => {
  const { t } = useLanguage();
  const mainVariant = isNextUp ? "default" : "outline";
  if (resultMode !== "live") {
    return (
      <Button variant={mainVariant} className="h-11 flex-1 gap-1.5 rounded-[10px] font-semibold" onClick={onEnterResult}>
        <Pencil className="h-4 w-4" /> {t("league.enterResultBtn")}
      </Button>
    );
  }
  return (
    <>
      <Button variant={mainVariant} className="h-11 flex-1 gap-1.5 rounded-[10px] font-semibold" onClick={onPlay}>
        <Play className="h-4 w-4" /> {t("league.playBtn")}
      </Button>
      {canPlayOnline && (
        <Button variant="outline" className="h-11 gap-1.5 rounded-[10px] px-3.5" disabled={startingOnline} onClick={onPlayOnline}>
          {startingOnline ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />} {t("game.setupOnline")}
        </Button>
      )}
    </>
  );
};

export default LeagueFixtureActions;
