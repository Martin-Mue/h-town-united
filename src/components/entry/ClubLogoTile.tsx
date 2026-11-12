interface ClubLogoTileProps {
  /** Resolved public logo URL, or null to show the club's initial instead. */
  logoUrl: string | null;
  name: string;
}

/** The club logo as a small rounded tile (same shape as the redesigned header), or the club's first
 *  letter when no logo is set. */
const ClubLogoTile = ({ logoUrl, name }: ClubLogoTileProps) =>
  logoUrl ? (
    <img src={logoUrl} alt={name} className="h-12 w-12 shrink-0 rounded-xl border border-border object-cover" />
  ) : (
    <div
      role="img"
      aria-label={name}
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted font-display text-2xl font-bold text-primary"
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );

export default ClubLogoTile;
