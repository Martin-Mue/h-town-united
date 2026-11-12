import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Always-dark container for the venue screen (TV/tablet across the room), whatever the viewer's
 * device is set to. `dark` swaps in the dark surface tokens for everything inside; `venue-dark`
 * (index.css) swaps the club's colors in their dark tones, so e.g. Dartspot shows its yellow
 * action color here even on a phone in light mode (where its normal action color is near-black).
 */
const VenueDarkSurface = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("dark venue-dark", className)}>{children}</div>
);

export default VenueDarkSurface;
