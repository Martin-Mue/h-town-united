import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Small uppercase section heading of the redesign (12px, 0.12em letter-spacing, secondary text). */
const LiveSectionLabel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <h3 className={cn("font-body text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1.5", className)}>
    {children}
  </h3>
);

export default LiveSectionLabel;
