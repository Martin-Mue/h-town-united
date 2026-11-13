import type { CheckoutRule } from "@/utils/playerLineup";
import type { OutRule } from "@/utils/x01Rules";
import { useLanguage } from "@/contexts/LanguageContext";
import SetupSectionLabel from "./SetupSectionLabel";
import ChoiceChip from "./ChoiceChip";

interface CheckoutRulePickerProps {
  rule: CheckoutRule;
  /** Sets the out rule for every player at once (per-player rules stay under "Mehr Optionen"). */
  onRuleChange: (rule: OutRule) => void;
}

/** Double Out / Single Out / Master Out (finish on a double or treble) for the whole game; shows a hint instead of a choice when players were set differently. */
const CheckoutRulePicker = ({ rule, onRuleChange }: CheckoutRulePickerProps) => {
  const { t } = useLanguage();
  return (
    <section className="space-y-2" aria-labelledby="setup-checkout-label">
      <SetupSectionLabel id="setup-checkout-label" aside={rule === "mixed" ? t("game.checkoutMixed") : undefined}>
        {t("game.setupCheckout")}
      </SetupSectionLabel>
      <div className="grid grid-cols-3 gap-2">
        <ChoiceChip className="px-1.5" selected={rule === "double"} onClick={() => onRuleChange("double")}>{t("game.doubleOut")}</ChoiceChip>
        <ChoiceChip className="px-1.5" selected={rule === "single"} onClick={() => onRuleChange("single")}>{t("game.singleOut")}</ChoiceChip>
        <ChoiceChip className="px-1.5" selected={rule === "master"} onClick={() => onRuleChange("master")}>{t("game.masterOut")}</ChoiceChip>
      </div>
      {rule === "master" && <p className="text-xs text-muted-foreground">{t("game.masterOutHint")}</p>}
    </section>
  );
};

export default CheckoutRulePicker;
