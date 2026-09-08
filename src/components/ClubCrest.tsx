import { useId } from "react";

interface ClubCrestProps {
  /** Resolved public URL of the club logo, or null/undefined to fall back to the initial. */
  logoUrl?: string | null;
  alt: string;
  /** Single character shown on a tinted shield background when no logo is set. */
  initial: string;
  /** Width in px; height follows the shield's fixed aspect ratio. Defaults to 64 (the w-16 box
   *  Auth.tsx and InvitePage.tsx both used before this existed). */
  size?: number;
  className?: string;
}

/**
 * "Vereinswappen" — one of Round 3's three unscheduled design directions (design-only, no ranked
 * audit finding behind it). Players.tsx already has a circular/medallion logo treatment for its
 * own club-management header (a spinning, glowing round frame) — this is deliberately a DIFFERENT
 * shape for a different kind of moment: a proper heraldic shield, used where the club is
 * introducing itself to someone who isn't (yet) a member — Auth.tsx's login/signup header and
 * InvitePage.tsx's invite-landing header, both of which previously used a plain `rounded-xl` box
 * — rather than where an existing member is managing the club day to day.
 *
 * Renders the club logo clipped into the shield outline when one is set, or the club's initial
 * letter on a shield-shaped tinted background — the same fallback Auth.tsx already had, just
 * shield-shaped instead of a rounded square. Pure presentational component: takes already-
 * resolved logoUrl/initial props, fetches nothing, decides nothing about branding.
 */
const ClubCrest = ({ logoUrl, alt, initial, size = 64, className = "" }: ClubCrestProps) => {
  const clipId = useId();
  // Flat-topped, gently curved-in sides tapering to a point — reads as a classic club/heraldic
  // shield rather than a generic rounded shape, distinct at a glance from Players.tsx's circle.
  const shieldPath = "M10,10 H90 V50 C90,85 72,100 50,108 C28,100 10,85 10,50 Z";

  return (
    <svg
      role="img"
      aria-label={alt}
      width={size}
      height={Math.round(size * 1.1)}
      viewBox="0 0 100 110"
      className={`glow-cyan mx-auto mb-4 ${className}`}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={shieldPath} />
        </clipPath>
      </defs>
      {logoUrl ? (
        <image
          href={logoUrl}
          x="0"
          y="0"
          width="100"
          height="110"
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
        />
      ) : (
        <>
          <path d={shieldPath} fill="hsl(var(--primary)/0.1)" />
          <text
            x="50"
            y="56"
            textAnchor="middle"
            dominantBaseline="middle"
            className="font-display fill-primary font-bold"
            style={{ fontSize: "34px" }}
          >
            {initial}
          </text>
        </>
      )}
      <path d={shieldPath} fill="none" stroke="hsl(var(--primary)/0.5)" strokeWidth="3" />
    </svg>
  );
};

export default ClubCrest;
