import { useEffect, useMemo, useState } from "react";
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
  const [dismissed, setDismissed] = useState(false);

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

  // Auto-dismiss after 9s if user doesn't close.
  useEffect(() => {
    const t = window.setTimeout(() => setDismissed(true), 9000);
    return () => window.clearTimeout(t);
  }, []);

  if (dismissed) return null;

  const close = () => {
    setDismissed(true);
    onClose?.();
  };

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

      {/* Trophy */}
      <div className="relative animate-trophy-drop">
        <div className="relative w-48 h-56 flex items-center justify-center drop-shadow-[0_10px_40px_hsl(var(--dart-gold)/0.55)]">
          {/* Cup */}
          <div className="relative">
            <div
              className="relative w-36 h-36 rounded-b-[3rem] rounded-t-3xl border-4 border-[hsl(var(--dart-gold))] overflow-hidden"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--dart-gold)) 0%, hsl(45 95% 65%) 45%, hsl(38 85% 35%) 100%)",
              }}
            >
              <Trophy className="absolute inset-0 m-auto w-16 h-16 text-background/40" />
              {/* Shine sweep */}
              <div className="absolute inset-y-0 w-1/3 bg-white/40 blur-md animate-trophy-shine" />
            </div>
            {/* Handles */}
            <div className="absolute -left-6 top-6 w-6 h-16 rounded-full border-4 border-[hsl(var(--dart-gold))] border-r-transparent" />
            <div className="absolute -right-6 top-6 w-6 h-16 rounded-full border-4 border-[hsl(var(--dart-gold))] border-l-transparent" />
            {/* Stem */}
            <div className="mx-auto w-10 h-6 -mt-1 bg-[hsl(var(--dart-gold))]" />
            {/* Base */}
            <div
              className="mx-auto w-44 h-10 rounded-md border-2 border-[hsl(var(--dart-gold))] flex items-center justify-center px-3"
              style={{
                background:
                  "linear-gradient(180deg, hsl(38 75% 45%), hsl(28 65% 22%))",
              }}
            >
              <span
                className="block w-full text-center font-display uppercase text-sm md:text-base text-[hsl(48_95%_85%)] truncate animate-engrave-in"
                style={{ textShadow: "0 1px 0 rgba(0,0,0,0.6), 0 0 6px rgba(255,200,80,0.4)" }}
              >
                {champion}
              </span>
            </div>
          </div>
        </div>
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