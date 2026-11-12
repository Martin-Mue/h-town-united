import type { ReactNode } from "react";

/** 12px uppercase section label of the redesign, with an optional note or control on the right. */
const SectionLabel = ({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) => (
  <div className="mb-2 flex min-h-[1.5rem] flex-wrap items-center justify-between gap-x-3 gap-y-2">
    <h2 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{children}</h2>
    {trailing}
  </div>
);

export default SectionLabel;
