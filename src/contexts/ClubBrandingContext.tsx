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
  refetch: () => Promise<void>;
}

// Pre-fetch / fetch-error fallback only -- matches the seed row so a network hiccup never
// leaves the app looking broken or blank for existing members.
const FALLBACK_NAME = "H-Town United e.V.";

const ClubBrandingContext = createContext<ClubBrandingContextType>({
  club: null,
  clubId: null,
  name: FALLBACK_NAME,
  tagline: null,
  logoUrl: htuLogoFallback,
  loading: true,
  refetch: async () => {},
});

export const useClubBranding = () => useContext(ClubBrandingContext);

export const ClubBrandingProvider = ({ children }: { children: ReactNode }) => {
  const [club, setClub] = useState<ClubRow | null>(null);
  const [loading, setLoading] = useState(true);
  const { resolvedTheme } = useTheme();
  const { user, loading: authLoading } = useAuth();

  const fetchClub = async () => {
    setLoading(true);
    if (user) {
      // Authenticated: resolve the caller's OWN club via their membership row, not just
      // "whichever club happens to exist" -- this is what makes branding correct once a
      // second club exists. Two plain queries (not a PostgREST embed) to match this codebase's
      // existing convention of joining client-side rather than relying on embedded selects.
      const { data: roleRow } = await supabase.from("user_roles").select("club_id").eq("user_id", user.id).maybeSingle();
      if (roleRow?.club_id) {
        const { data: clubRow } = await supabase.from("clubs").select("*").eq("id", roleRow.club_id).maybeSingle();
        setClub(clubRow ?? null);
      } else {
        // Authenticated but genuinely no membership row (mid-onboarding, right after signup) --
        // stays null rather than falling back to "the first club" the way an anonymous visitor
        // does below. This null is exactly the signal RequireClub (App.tsx) uses to redirect to
        // /create-club -- silently showing them some other club's branding here would both be
        // misleading and mask that redirect from ever firing.
        setClub(null);
      }
      setLoading(false);
      return;
    }
    // Anonymous visitor: today there's only ever one club, so this always resolves to it -- same
    // behavior as before this rework. Once a real multi-club landing exists for a cold,
    // un-invited visitor, this is the spot to swap in a neutral, non-club-specific identity instead.
    const { data } = await supabase.from("clubs").select("*").order("created_at", { ascending: true }).limit(1).maybeSingle();
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
    refetch: fetchClub,
  };

  return <ClubBrandingContext.Provider value={value}>{children}</ClubBrandingContext.Provider>;
};
