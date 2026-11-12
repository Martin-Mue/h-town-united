import { X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { useGamePresets } from "@/hooks/useGamePresets";
import { describePreset, type GamePresetConfig } from "@/utils/gamePreset";
import SetupSectionLabel from "@/components/game/setup/SetupSectionLabel";

interface GamePresetsProps {
  onApply: (config: GamePresetConfig) => void;
}

/**
 * "Schnellstart" on the new-game screen: the account's saved setups as one-tap chips (tap = the whole setup is
 * filled in, then "Spiel starten"). Renders nothing until something was saved — saving lives in "Mehr Optionen"
 * (SaveGamePresetForm), the last game in the header ("Wie letztes Mal").
 */
const GamePresets = ({ onApply }: GamePresetsProps) => {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { presets, signedIn, deletePreset } = useGamePresets();

  if (!signedIn || presets.length === 0) return null;

  const remove = async (id: string) => {
    const error = await deletePreset(id);
    if (error) toast({ title: t("common.error"), description: error, variant: "destructive" });
  };

  return (
    <section className="space-y-2" aria-labelledby="setup-presets-label">
      <SetupSectionLabel id="setup-presets-label">{t("game.presetsTitle")}</SetupSectionLabel>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <div key={preset.id} className="flex min-w-0 max-w-full items-stretch overflow-hidden rounded-xl border border-border bg-card">
            <button type="button" onClick={() => onApply(preset.config)} className="min-h-[48px] min-w-0 px-3 py-1.5 text-left transition-colors hover:bg-muted">
              <span className="block truncate text-sm font-semibold">{preset.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{describePreset(preset.config, t("stats.firstTo"), t("game.playersSuffix"))}</span>
            </button>
            <button
              type="button"
              onClick={() => remove(preset.id)}
              aria-label={t("game.presetDelete")}
              title={t("game.presetDelete")}
              className="flex w-11 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};

export default GamePresets;
