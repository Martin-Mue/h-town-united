import type { ReactNode } from "react";

/** Calm frame for the pages a visitor sees before (or instead of) the app itself: login, password
 *  reset, invite and join links, club creation. Plain page background, one narrow column, no
 *  gradient wash or glow (redesign 2026-11). */
const EntryPageShell = ({ children }: { children: ReactNode }) => (
  <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center px-4 py-8">
    <div className="w-full max-w-sm flex flex-col gap-4">{children}</div>
  </div>
);

export default EntryPageShell;
