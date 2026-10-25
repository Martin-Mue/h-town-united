import { useState } from "react";
import { Bookmark, Check, History, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard, Eyebrow } from "@/components/stats/StatPrimitives";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { useGamePresets } from "@/hooks/useGamePresets";
import { useAuth } from "@/contexts/AuthContext";
import { describePreset, loadLastGameSetup, type GamePresetConfig } from "@/utils/gamePreset";

interface GamePresetsProps {
  /** The setup as it is on screen right now — what "save" stores. */
  current: GamePresetConfig;
  onApply: (config: GamePresetConfig) => void;
}

/**
 * "Schnellstart" above the new-game form: the account's saved setups as one-tap chips (tap = the whole setup is filled
 * in, then "Spiel starten"), and a small field to save what is on screen as a new one.
 */
const GamePresets = ({ current, onApply }: GamePresetsProps) => {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { presets, signedIn, savePreset, deletePreset } = useGamePresets();
  const { session } = useAuth();
  const last = loadLastGameSetup(session?.user?.id);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  if (!signedIn) return null;

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const error = await savePreset(name, current);
    setBusy(false);
    if (error) {
      toast({ title: t("common.error"), description: error, variant: "destructive" });
      return;
    }
    toast({ title: t("game.presetSaved") });
    setName("");
    setNaming(false);
  };

  const remove = async (id: string) => {
    const error = await deletePreset(id);
    if (error) toast({ title: t("common.error"), description: error, variant: "destructive" });
  };

  return (
    <SectionCard className="mb-4 space-y-3">
      <Eyebrow icon={Zap}>{t("game.presetsTitle")}</Eyebrow>
      {presets.length === 0 && !last ? (
        <p className="text-xs text-muted-foreground">{t("game.presetsEmpty")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {last && (
            <button type="button" onClick={() => onApply(last)} className="min-w-0 rounded-xl border border-accent/50 bg-accent/10 px-3 py-2 text-left transition-colors hover:bg-accent/20">
              <span className="flex items-center gap-1.5 truncate font-display text-sm uppercase tracking-wide"><History className="h-3.5 w-3.5 shrink-0" /> {t("game.presetLast")}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{describePreset(last, t("stats.firstTo"), t("game.playersSuffix"))}{last.playerNames.length > 0 ? ` · ${last.playerNames.join(", ")}` : ""}</span>
            </button>
          )}
          {presets.map((preset) => (
            <div key={preset.id} className="flex items-stretch overflow-hidden rounded-xl border border-primary/40 bg-primary/10">
              <button type="button" onClick={() => onApply(preset.config)} className="min-w-0 px-3 py-2 text-left transition-colors hover:bg-primary/20">
                <span className="block truncate font-display text-sm uppercase tracking-wide">{preset.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{describePreset(preset.config, t("stats.firstTo"), t("game.playersSuffix"))}</span>
              </button>
              <button
                type="button"
                onClick={() => remove(preset.id)}
                aria-label={t("game.presetDelete")}
                title={t("game.presetDelete")}
                className="flex w-9 shrink-0 items-center justify-center border-l border-primary/30 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {naming ? (
        <div className="flex items-center gap-2">
          <Input
            value={name}
            maxLength={40}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
            placeholder={t("game.presetNamePlaceholder")}
            className="bg-muted border-border"
          />
          <Button size="icon" onClick={save} disabled={!name.trim() || busy} aria-label={t("game.save")}><Check className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" onClick={() => { setNaming(false); setName(""); }} aria-label={t("common.cancel")}><X className="h-4 w-4" /></Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setNaming(true)}>
          <Bookmark className="h-3.5 w-3.5" /> {t("game.presetSave")}
        </Button>
      )}
    </SectionCard>
  );
};

export default GamePresets;
