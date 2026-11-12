import type { CheckoutRule } from "@/utils/playerLineup";
import { useLanguage } from "@/contexts/LanguageContext";
import SetupSectionLabel from "./SetupSectionLabel";
import ChoiceChip from "./ChoiceChip";

interface CheckoutRulePickerProps {
  rule: CheckoutRule;
  /** Sets the out rule for every player at once (per-player rules stay under "Mehr Optionen"). */
  onRuleChange: (doubleOut: boolean) => void;
}

/** Double Out / Single Out for the whole game; shows a hint instead of a choice when players were set differently. */
const CheckoutRulePicker = ({ rule, onRuleChange }: CheckoutRulePickerProps) => {
  const { t } = useLanguage();
  return (
    <section className="space-y-2" aria-labelledby="setup-checkout-label">
      <SetupSectionLabel id="setup-checkout-label" aside={rule === "mixed" ? t("game.checkoutMixed") : undefined}>
        {t("game.setupCheckout")}
      </SetupSectionLabel>
      <div className="grid grid-cols-2 gap-2">
        <ChoiceChip selected={rule === "double"} onClick={() => onRuleChange(true)}>{t("game.doubleOut")}</ChoiceChip>
        <ChoiceChip selected={rule === "single"} onClick={() => onRuleChange(false)}>{t("game.singleOut")}</ChoiceChip>
      </div>
    </section>
  );
};

export default CheckoutRulePicker;
