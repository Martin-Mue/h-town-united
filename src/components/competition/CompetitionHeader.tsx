import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

interface CompetitionHeaderProps {
  /** Small uppercase line above the title, e.g. "501 · 8 Teilnehmer · Saison 1". */
  kicker?: ReactNode;
  title: ReactNode;
  /** Square back button left of the title (redesign canvas "Neues Spiel" header). */
  backTo?: string;
  /** Same back button for a screen that leaves by changing state instead of the route (tournament detail, setup). */
  onBack?: () => void;
  backLabel?: string;
  /** One button at the right edge, bottom-aligned with the title. */
  action?: ReactNode;
  /** Extra lines below the title (meta text, season links). */
  children?: ReactNode;
}

/** Page header of the league and season screens: kicker line, 28px display title, optional back button and action. */
const BACK_BUTTON_CLASS =
  "mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:text-foreground";

const CompetitionHeader = ({ kicker, title, backTo, onBack, backLabel, action, children }: CompetitionHeaderProps) => (
  <header className="mb-5 flex flex-col gap-2">
    <div className="flex items-end gap-3">
      {onBack && !backTo && (
        <button type="button" onClick={onBack} aria-label={backLabel} title={backLabel} className={BACK_BUTTON_CLASS}>
          <ChevronLeft aria-hidden="true" className="h-5 w-5" />
        </button>
      )}
      {backTo && (
        <Link
          to={backTo}
          aria-label={backLabel}
          title={backLabel}
          className={BACK_BUTTON_CLASS}
        >
          <ChevronLeft aria-hidden="true" className="h-5 w-5" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        {kicker && <p className="truncate text-xs uppercase tracking-[0.12em] text-muted-foreground">{kicker}</p>}
        <h1 className="break-words font-display text-[28px] font-bold leading-tight">{title}</h1>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
    {children}
  </header>
);

export default CompetitionHeader;
