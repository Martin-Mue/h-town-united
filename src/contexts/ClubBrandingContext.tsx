import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { resolveClubTheme, DEFAULT_CLUB_THEME_PRESET_ID } from "@/lib/clubThemePresets";
import htuLogoFallback from "@/assets/htu-logo.jpg";

interface ClubRow {
  id: string;
  name: string;
  tagline: string | null;
  logo_path: string | null;
  theme_preset: string;
}

interface ClubBrandingContextType {
  club: ClubRow | null;
  clubId: string | null;
  name: string;
  tagline: string | null;
  logoUrl: string;
  loading: boolean;
  /** True only after a network/query error resolving an AUTHENTICATED user's own membership,
   *  and every automatic retry has also failed. RequireClub (App.tsx) must treat this the same
   *  as still-loading, NEVER as "confirmed no club" -- see the resolved flag below for why this
   *  distinction exists at all. */
  membershipError: boolean;
  refetch: () => Promise<void>;
}

// Pre-fetch / fetch-error fallback only -- matches the seed row so a network hiccup never
// leaves the app looking broken or blank for existing members.
const FALLBACK_NAME = "H-Town United e.V.";
const RETRY_DELAY_MS = 2000;

const ClubBrandingContext = createContext<ClubBrandingContextType>({
  club: null,
  clubId: null,
  name: FALLBACK_NAME,
  tagline: null,
  logoUrl: htuLogoFallback,
  loading: true,
  membershipError: false,
  refetch: async () => {},
});

export const useClubBranding = () => useContext(ClubBrandingContext);

export const ClubBrandingProvider = ({ children }: { children: ReactNode }) => {
  const [club, setClub] = useState<ClubRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [membershipError, setMembershipError] = useState(false);
  const { resolvedTheme } = useTheme();
  const { user, loading: authLoading } = useAuth();

  const fetchClub = async (isRetry = false) => {
    if (!isRetry) setLoading(true);
    if (user) {
      // Authenticated: resolve the caller's OWN club via their membership row, not just
      // "whichever club happens to exist" -- this is what makes branding correct once a
      // second club exists. Two plain queries (not a PostgREST embed) to match this codebase's
      // existing convention of joining client-side rather than relying on embedded selects.
      const { data: roleRow, error: roleError } = await supabase.from("user_roles").select("club_id").eq("user_id", user.id).maybeSingle();
      const { data: clubRow, error: clubError } = roleError
        ? { data: null, error: null }
        : roleRow?.club_id
          ? await supabase.from("clubs").select("*").eq("id", roleRow.club_id).maybeSingle()
          : { data: null, error: null };

      // A query ERROR (RLS hiccup, dropped connection, ...) must NEVER be treated the same as a
      // genuinely-empty result -- RequireClub (App.tsx) reads `!club` as "this account has no
      // club" and redirects to /create-club. Confusing "we don't know yet" with "confirmed
      // clubless" would wrongly bounce an EXISTING member there on a transient failure. One
      // automatic retry after a short delay; if that also fails, membershipError stays set (never
      // resolved as clubless) until something succeeds -- RequireClub keeps showing a fallback
      // instead of ever redirecting in this state.
      if (roleError || clubError) {
        if (!isRetry) {
          setTimeout(() => fetchClub(true), RETRY_DELAY_MS);
          return;
        }
        setMembershipError(true);
        setLoading(false);
        return;
      }

      setMembershipError(false);
      // roleRow being null/no club_id (with NO error) is the one legitimate "genuinely clubless"
      // case -- mid-onboarding, right after signup, before /create-club or an invite has run.
      setClub(clubRow ?? null);
      setLoading(false);
      return;
    }
    // Anonymous visitor: reads the public-safe view (the base `clubs` table's SELECT is
    // authenticated-members-only, see the plan_tier migration) -- today there's only ever one
    // club, so this always resolves to it, same behavior as before this rework. Once a real
    // multi-club landing exists for a cold, un-invited visitor, this is the spot to swap in a
    // neutral, non-club-specific identity instead.
    const { data } = await supabase.from("clubs_public").select("*").limit(1).maybeSingle();
    if (data) setClub(data);
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading) return;
    fetchClub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  // Re-apply CSS vars whenever the preset or the resolved light/dark mode changes.
  useEffect(() => {
    const mode = resolvedTheme === "light" ? "light" : "dark";
    const vars = resolveClubTheme(club?.theme_preset ?? DEFAULT_CLUB_THEME_PRESET_ID, mode);
    const root = document.documentElement.style;
    Object.entries(vars).forEach(([key, value]) => root.setProperty(key, value));
  }, [club?.theme_preset, resolvedTheme]);

  const logoUrl = useMemo(() => {
    if (!club?.logo_path) return htuLogoFallback;
    return supabase.storage.from("club-logos").getPublicUrl(club.logo_path).data.publicUrl;
  }, [club?.logo_path]);

  // document.title / favicon: cheap, browser-tab-only wins, distinct from the harder
  // PWA-manifest problem (vite.config.ts, index.html meta/OG tags), which stays out of scope.
  useEffect(() => {
    if (!club) return;
    document.title = `${club.name} · Darts Club`;
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) favicon.href = logoUrl;
  }, [club, logoUrl]);

  const value: ClubBrandingContextType = {
    club,
    clubId: club?.id ?? null,
    name: club?.name ?? FALLBACK_NAME,
    tagline: club?.tagline ?? null,
    logoUrl,
    loading,
    membershipError,
    refetch: () => fetchClub(),
  };

  return <ClubBrandingContext.Provider value={value}>{children}</ClubBrandingContext.Provider>;
};
