import { useEffect, useMemo } from "react";
import { Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TrophyCeremonyProps {
  champion: string;
  tournamentName?: string;
  onClose?: () => void;
}

const CONFETTI_COLORS = [
  "hsl(var(--accent))",
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(var(--dart-gold))",
  "hsl(var(--dart-cyan))",
];

/**
 * Full-screen ceremony overlay: golden trophy drops in, sparkles,
 * and the champion's name gets "engraved" on the plate.
 */
const TrophyCeremony = ({ champion, tournamentName, onClose }: TrophyCeremonyProps) => {
  // Generate confetti pieces once per mount.
  const confetti = useMemo(
    () =>
      Array.from({ length: 60 }).map((_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 1.6,
        duration: 2.6 + Math.random() * 2.4,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + Math.random() * 8,
      })),
    []
  );

  // Auto-dismiss after 9s — fully unmounts via parent so it can be replayed.
  useEffect(() => {
    const t = window.setTimeout(() => onClose?.(), 9000);
    return () => window.clearTimeout(t);
  }, [onClose]);

  const close = () => onClose?.();

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/85 backdrop-blur-sm">
      {/* Confetti layer */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {confetti.map((c) => (
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

      <Button
        variant="ghost"
        size="icon"
        onClick={close}
        className="absolute right-4 top-4 z-10 text-muted-foreground hover:text-foreground"
        aria-label="Schließen"
      >
        <X className="h-5 w-5" />
      </Button>

      <p className="font-display uppercase text-xs tracking-[0.4em] text-accent/80 mb-2 animate-fade-in">
        Champion
      </p>
      {tournamentName && (
        <p className="text-sm text-muted-foreground mb-4 animate-fade-in">{tournamentName}</p>
      )}

      {/* Trophy (SVG for clean classic cup shape) */}
      <div className="relative animate-trophy-drop drop-shadow-[0_10px_40px_hsl(var(--dart-gold)/0.55)]">
        <svg viewBox="0 0 200 240" className="w-48 h-56" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="cupGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="hsl(48 95% 70%)" />
              <stop offset="50%" stopColor="hsl(45 95% 55%)" />
              <stop offset="100%" stopColor="hsl(35 85% 35%)" />
            </linearGradient>
            <linearGradient id="baseGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="hsl(38 75% 45%)" />
              <stop offset="100%" stopColor="hsl(28 65% 22%)" />
            </linearGradient>
            <clipPath id="cupClip">
              <path d="M55 30 H145 V100 Q145 150 100 155 Q55 150 55 100 Z" />
            </clipPath>
          </defs>
          {/* Handles */}
          <path d="M55 45 Q25 50 25 80 Q25 110 55 110" fill="none" stroke="hsl(45 95% 50%)" strokeWidth="8" strokeLinecap="round" />
          <path d="M145 45 Q175 50 175 80 Q175 110 145 110" fill="none" stroke="hsl(45 95% 50%)" strokeWidth="8" strokeLinecap="round" />
          {/* Cup body */}
          <path d="M55 30 H145 V100 Q145 150 100 155 Q55 150 55 100 Z" fill="url(#cupGrad)" stroke="hsl(45 95% 45%)" strokeWidth="2.5" />
          {/* Shine sweep inside cup */}
          <rect x="65" y="35" width="18" height="115" fill="white" opacity="0.35" className="animate-trophy-shine" clipPath="url(#cupClip)" />
          {/* Stem */}
          <rect x="90" y="155" width="20" height="18" fill="hsl(45 95% 50%)" />
          {/* Plate (engraving) */}
          <rect x="40" y="173" width="120" height="32" rx="4" fill="url(#baseGrad)" stroke="hsl(45 95% 45%)" strokeWidth="2" />
          {/* Base foot */}
          <rect x="30" y="205" width="140" height="14" rx="3" fill="url(#baseGrad)" stroke="hsl(45 95% 45%)" strokeWidth="2" />
          {/* Inner cup icon */}
          <g opacity="0.35" transform="translate(78 55)">
            <path d="M0 0 h44 v18 q0 18 -22 22 q-22 -4 -22 -22 z" fill="hsl(28 65% 22%)" />
            <rect x="18" y="40" width="8" height="6" fill="hsl(28 65% 22%)" />
            <rect x="10" y="46" width="24" height="5" fill="hsl(28 65% 22%)" />
          </g>
          {/* Engraved champion name */}
          <text
            x="100"
            y="195"
            textAnchor="middle"
            className="font-display animate-engrave-in"
            fill="hsl(48 95% 88%)"
            fontSize="14"
            fontWeight="700"
            style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}
          >
            {champion}
          </text>
        </svg>
      </div>

      <p className="mt-6 font-display uppercase text-2xl text-accent animate-engrave-in" style={{ animationDelay: "1.6s" }}>
        {champion}
      </p>
      <p className="text-xs text-muted-foreground mt-1 animate-fade-in" style={{ animationDelay: "2s" }}>
        Glückwunsch zum Turniersieg!
      </p>

      <Button onClick={close} variant="outline" className="mt-8 animate-fade-in" style={{ animationDelay: "2.2s" }}>
        Weiter
      </Button>
    </div>
  );
};

export default TrophyCeremony;