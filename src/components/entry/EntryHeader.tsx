import type { ReactNode } from "react";

interface EntryHeaderProps {
  /** Left tile: the club logo (ClubLogoTile) or an icon tile (EntryIconTile). */
  mark: ReactNode;
  /** Small uppercase line above the title, e.g. the club name. */
  eyebrow?: string;
  title: string;
  /** One calm line under the header, e.g. the club tagline. */
  subtitle?: string | null;
}

/** Page header of the entry pages: small mark + small label + 28px title, like the Start page. */
const EntryHeader = ({ mark, eyebrow, title, subtitle }: EntryHeaderProps) => (
  <header className="flex flex-col gap-2">
    <div className="flex items-center gap-3">
      {mark}
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="truncate text-xs uppercase tracking-[0.12em] text-muted-foreground">{eyebrow}</p>}
        <h1 className="font-display text-[28px] font-bold leading-tight break-words">{title}</h1>
      </div>
    </div>
    {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
  </header>
);

export default EntryHeader;
