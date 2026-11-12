import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface TrainingScreenHeaderProps {
  onBack: () => void;
  title: string;
  /** Small line under the title (e.g. the round counter on a play screen). */
  subtitle?: ReactNode;
  /** Large page title (setup screen) or a compact one-line title (play screen). */
  size?: "page" | "compact";
  trailing?: ReactNode;
}

/** Back button + title row shared by the drill setup and drill play screens. */
const TrainingScreenHeader = ({ onBack, title, subtitle, size = "page", trailing }: TrainingScreenHeaderProps) => {
  const { t } = useLanguage();
  return (
    <header className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        aria-label={t("common.back")}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        {size === "page" ? (
          <h1 className="truncate font-display text-[28px] font-bold leading-tight">{title}</h1>
        ) : (
          <h1 className="truncate text-[15px] font-semibold leading-tight">{title}</h1>
        )}
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {trailing}
    </header>
  );
};

export default TrainingScreenHeader;
