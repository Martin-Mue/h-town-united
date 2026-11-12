import type { ReactNode } from "react";

/** Flat card holding an entry page's form or message. */
const EntryCard = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <section className={`rounded-2xl border border-border bg-card p-5 ${className}`}>{children}</section>
);

export default EntryCard;
