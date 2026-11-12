import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small uppercase heading above a block of the club page ("MITGLIEDER", "STECKBRIEF" …). */
export const PlayersSectionLabel = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <h2 className={cn("text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground", className)}>{children}</h2>
);

/** Flat card used for every block on the club page. */
export const PlayersCard = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={cn("rounded-2xl border border-border bg-card p-4", className)}>{children}</div>
);

/** One number with a small label above it — the big-number tile of the redesign. */
export const PlayerNumberTile = ({ label, value, sub, icon: Icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: LucideIcon }) => (
  <div className="min-w-0 rounded-2xl border border-border bg-card px-3.5 py-3">
    <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />}
      {label}
    </p>
    <p className="font-display font-bold text-[30px] leading-tight tabular-nums truncate">{value}</p>
    {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
  </div>
);
