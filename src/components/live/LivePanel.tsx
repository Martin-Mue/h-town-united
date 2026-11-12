import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Flat redesign card for the public live pages: card surface, 1px line, 20px radius, no shadow. */
const LivePanel = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("rounded-[20px] border border-border bg-card p-4", className)}>{children}</div>
);

export default LivePanel;
