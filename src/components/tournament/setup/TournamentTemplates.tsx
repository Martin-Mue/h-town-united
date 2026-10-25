import { useState } from "react";
import { Bookmark, Check, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard, Eyebrow } from "@/components/stats/StatPrimitives";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { useTournamentTemplates } from "@/hooks/useGamePresets";
import type { TournamentTemplate } from "@/utils/tournamentTemplate";

interface TournamentTemplatesProps {
  /** The format as it is on screen right now — what "save" stores. */
  current: TournamentTemplate;
  onApply: (template: TournamentTemplate) => void;
}

/** One line for a chip: "K.O. · 501 · First to 2 · 2 Boards". */
const describe = (tpl: TournamentTemplate, t: (key: string) => string): string =>
  [
    tpl.tournamentMode === "round-robin" ? t("tournament.roundRobin") : t("tournament.koSystem"),
    tpl.gameMode,
    `${t("stats.firstTo")} ${Math.ceil(tpl.bestOfLegs / 2)}`,
    `${tpl.boards} ${t("camera.board")}${tpl.boards > 1 ? "s" : ""}`,
    ...(tpl.doublesEnabled ? [t("tournament.doubles")] : []),
  ].join(" · ");

/**
 * "Vorlagen" at the top of the tournament setup: the account's saved formats as one-tap chips (the whole format is
 * filled in, only name and participants are left), and a field to save the current format as a new template.
 */
const TournamentTemplates = ({ current, onApply }: TournamentTemplatesProps) => {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { presets, signedIn, savePreset, deletePreset } = useTournamentTemplates();
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
    toast({ title: t("tournament.templateSaved") });
    setName("");
    setNaming(false);
  };

  const remove = async (id: string) => {
    const error = await deletePreset(id);
    if (error) toast({ title: t("common.error"), description: error, variant: "destructive" });
  };

  return (
    <SectionCard className="space-y-3">
      <Eyebrow icon={Zap}>{t("tournament.templatesTitle")}</Eyebrow>
      {presets.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("tournament.templatesEmpty")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <div key={preset.id} className="flex items-stretch overflow-hidden rounded-xl border border-primary/40 bg-primary/10">
              <button type="button" onClick={() => onApply(preset.config)} className="min-w-0 px-3 py-2 text-left transition-colors hover:bg-primary/20">
                <span className="block truncate font-display text-sm uppercase tracking-wide">{preset.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{describe(preset.config, t)}</span>
              </button>
              <button
                type="button"
                onClick={() => remove(preset.id)}
                aria-label={t("tournament.templateDelete")}
                title={t("tournament.templateDelete")}
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
            placeholder={t("tournament.templateNamePlaceholder")}
            className="bg-muted border-border"
          />
          <Button size="icon" onClick={save} disabled={!name.trim() || busy} aria-label={t("game.save")}><Check className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" onClick={() => { setNaming(false); setName(""); }} aria-label={t("common.cancel")}><X className="h-4 w-4" /></Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setNaming(true)}>
          <Bookmark className="h-3.5 w-3.5" /> {t("tournament.templateSave")}
        </Button>
      )}
    </SectionCard>
  );
};

export default TournamentTemplates;
