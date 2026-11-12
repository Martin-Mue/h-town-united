import type { ReactNode } from "react";

/** Small uppercase section heading used across the Training screens (redesign 2026-11). */
const TrainingSectionLabel = ({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-2">
    <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{children}</h2>
    {trailing && <span className="text-[13px] text-muted-foreground">{trailing}</span>}
  </div>
);

export default TrainingSectionLabel;
