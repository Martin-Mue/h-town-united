import type { GameMode } from "@/types/game";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import SettingToggleRow from "./SettingToggleRow";

interface FormatOptionsProps {
  mode: GameMode;
  isTournamentMatch: boolean;
  setsEnabled: boolean;
  onSetsEnabledChange: (on: boolean) => void;
  checkoutSuggestionEnabled: boolean;
  onCheckoutSuggestionChange: (on: boolean) => void;
  customCricket: boolean;
  onCustomCricketChange: (on: boolean) => void;
  maxRoundsX01: number;
  onMaxRoundsChange: (rounds: number) => void;
}

/** Sets mode, checkout suggestions, round limit (X01) and custom numbers (Cricket). */
const FormatOptions = ({
  mode, isTournamentMatch, setsEnabled, onSetsEnabledChange, checkoutSuggestionEnabled, onCheckoutSuggestionChange,
  customCricket, onCustomCricketChange, maxRoundsX01, onMaxRoundsChange,
}: FormatOptionsProps) => {
  const { t } = useLanguage();
  if (mode === "cricket") {
    return (
      <SettingToggleRow id="custom-cricket" label={t("game.customCricket")} description={t("game.customCricketDesc")} checked={customCricket} onCheckedChange={onCustomCricketChange} />
    );
  }
  return (
    <>
      {/* A tournament match only shows the sets switch when its tournament uses sets (then it's locked on) —
          never a disabled, permanently-off toggle. See useTournamentLink's sets query params. */}
      {(!isTournamentMatch || setsEnabled) && (
        <SettingToggleRow id="sets-mode" label={t("game.setsMode")} description={t("game.setsModeDesc")} checked={setsEnabled} disabled={isTournamentMatch} onCheckedChange={onSetsEnabledChange} />
      )}
      <SettingToggleRow id="checkout-suggestions" label={t("game.checkoutSuggestions")} description={t("game.checkoutSuggestionsDesc")} checked={checkoutSuggestionEnabled} onCheckedChange={onCheckoutSuggestionChange} />
      <div className="space-y-1 rounded-xl border border-border bg-muted/40 px-4 py-3">
        <label className="block text-sm" htmlFor="round-limit">{t("game.roundLimitPerLeg")}</label>
        <Select value={String(maxRoundsX01)} onValueChange={(v) => onMaxRoundsChange(parseInt(v))}>
          <SelectTrigger id="round-limit" className="h-11 border-border bg-background"><SelectValue /></SelectTrigger>
          <SelectContent className="border-border bg-card">
            <SelectItem value="0">{t("game.noLimit")}</SelectItem>
            {[8, 10, 12, 15, 20, 25].map((n) => (
              <SelectItem key={n} value={String(n)}>{t("game.max")} {n} {t("game.rounds")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("game.roundLimitDesc")}</p>
      </div>
    </>
  );
};

export default FormatOptions;
