import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

/** "Mehr Optionen": the rarely changed settings, collapsed every time the screen opens and collapsible again. */
const MoreOptionsSection = ({ children }: { children: ReactNode }) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <section className="rounded-2xl border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left"
      >
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{t("game.moreOptions")}</span>
        <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div id={panelId} className="space-y-5 border-t border-border px-4 pb-4 pt-4">{children}</div>}
    </section>
  );
};

/** A titled group inside "Mehr Optionen". */
export const MoreOptionsGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="space-y-2">
    <h3 className="font-display text-[0.95rem] font-semibold uppercase tracking-wide text-foreground">{title}</h3>
    {children}
  </div>
);

export default MoreOptionsSection;
