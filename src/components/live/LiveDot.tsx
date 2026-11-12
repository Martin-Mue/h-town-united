import { cn } from "@/lib/utils";

/** Pulsing green "live" dot (secondary = live/won in the redesign). */
const LiveDot = ({ className }: { className?: string }) => (
  <span aria-hidden className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-secondary animate-pulse", className)} />
);

export default LiveDot;
