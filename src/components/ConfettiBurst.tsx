import { useMemo } from "react";

const CONFETTI_COLORS = [
  "hsl(var(--accent))",
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(var(--dart-gold))",
  "hsl(var(--dart-cyan))",
];

interface ConfettiBurstProps {
  /** Bump this (e.g. Date.now()) each time a burst should play — remounts the piece set
   *  so the CSS fall animation replays even for back-to-back triggers. */
  triggerKey: number;
  count?: number;
}

/** Lightweight, non-blocking confetti overlay for in-game highlight moments (180s,
 *  checkouts) — same falling-piece look as TrophyCeremony's celebration, minus the trophy. */
const ConfettiBurst = ({ triggerKey, count = 40 }: ConfettiBurstProps) => {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.3,
        duration: 1.6 + Math.random() * 1.2,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 5 + Math.random() * 7,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [triggerKey, count]
  );

  return (
    <div key={triggerKey} className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {pieces.map((c) => (
        <span
          key={c.id}
          className="absolute top-0 block rounded-sm animate-confetti-fall"
          style={{
            left: `${c.left}%`,
            width: c.size,
            height: c.size * 0.4,
            backgroundColor: c.color,
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.duration}s`,
          }}
        />
      ))}
    </div>
  );
};

export default ConfettiBurst;
