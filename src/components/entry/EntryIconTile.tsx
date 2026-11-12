import type { LucideIcon } from "lucide-react";

type EntryIconTone = "accent" | "destructive";

const TONE_CLASS: Record<EntryIconTone, string> = {
  accent: "text-accent",
  destructive: "text-destructive",
};

/** 48px tile holding one icon — the only place the entry pages use the highlight color. */
const EntryIconTile = ({ icon: Icon, tone = "accent" }: { icon: LucideIcon; tone?: EntryIconTone }) => (
  <div aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
    <Icon className={`h-6 w-6 ${TONE_CLASS[tone]}`} />
  </div>
);

export default EntryIconTile;
