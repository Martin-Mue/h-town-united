import type { ReactNode } from "react";

/** The small uppercase heading above each block of the new-game screen, with an optional note on the right. */
const SetupSectionLabel = ({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) => (
  <div className="flex items-baseline justify-between gap-2">
    <h2 id={id} className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{children}</h2>
    {aside && <span className="truncate text-[13px] text-muted-foreground">{aside}</span>}
  </div>
);

export default SetupSectionLabel;
