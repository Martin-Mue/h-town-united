import { useState } from "react";
import { Bookmark, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { useGamePresets } from "@/hooks/useGamePresets";
import type { GamePresetConfig } from "@/utils/gamePreset";

/** "Aktuelle Einstellungen speichern": names the setup on screen and stores it as a Schnellstart chip. Signed-in only. */
const SaveGamePresetForm = ({ current }: { current: GamePresetConfig }) => {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { signedIn, savePreset } = useGamePresets();
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

  if (!naming) {
    return (
      <Button variant="outline" className="h-11 w-full gap-1.5 rounded-xl" onClick={() => setNaming(true)}>
        <Bookmark className="h-4 w-4" /> {t("game.presetSave")}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        value={name}
        maxLength={40}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
        placeholder={t("game.presetNamePlaceholder")}
        className="h-11 border-border bg-muted"
      />
      <Button size="icon" className="h-11 w-11 shrink-0" onClick={save} disabled={!name.trim() || busy} aria-label={t("game.save")}><Check className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0" onClick={() => { setNaming(false); setName(""); }} aria-label={t("common.cancel")}><X className="h-4 w-4" /></Button>
    </div>
  );
};

export default SaveGamePresetForm;
