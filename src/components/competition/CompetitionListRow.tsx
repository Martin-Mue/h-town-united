import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

interface CompetitionListRowProps {
  to: string;
  icon: LucideIcon;
  title: string;
  meta: ReactNode;
  /** Edit/delete buttons at the right edge; outside the link so they don't open the detail page. */
  actions?: ReactNode;
}

/** One league or season in the overview list: flat card, icon tile, name and a muted meta line. */
const CompetitionListRow = ({ to, icon: Icon, title, meta, actions }: CompetitionListRowProps) => (
  <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3.5 py-3 transition-colors hover:border-primary/40">
    <Link to={to} className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-accent/15 text-accent">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{meta}</span>
      </span>
    </Link>
    {actions && <div className="flex shrink-0 items-center">{actions}</div>}
  </div>
);

export default CompetitionListRow;
