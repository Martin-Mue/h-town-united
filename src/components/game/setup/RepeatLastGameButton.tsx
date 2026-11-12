import { History } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { describePreset, loadLastGameSetup, type GamePresetConfig } from "@/utils/gamePreset";

interface RepeatLastGameButtonProps {
  userId: string | undefined;
  onApply: (config: GamePresetConfig) => void;
}

/** "Wie letztes Mal": fills in the setup of the last casual game started on this device (saved per account at start). */
const RepeatLastGameButton = ({ userId, onApply }: RepeatLastGameButtonProps) => {
  const { t } = useLanguage();
  const last = loadLastGameSetup(userId);
  if (!last) return null;
  const details = `${describePreset(last, t("stats.firstTo"), t("game.playersSuffix"))}${last.playerNames.length > 0 ? ` · ${last.playerNames.join(", ")}` : ""}`;
  return (
    <button
      type="button"
      onClick={() => onApply(last)}
      title={details}
      aria-label={`${t("game.repeatLastGame")}: ${details}`}
      className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-border px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
    >
      <History className="h-4 w-4 text-muted-foreground" />
      {t("game.repeatLastGame")}
    </button>
  );
};

export default RepeatLastGameButton;
