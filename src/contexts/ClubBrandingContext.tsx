import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useTheme } from "next-themes";
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

  const fetchClub = async () => {
    const { data } = await supabase.from("clubs").select("*").limit(1).maybeSingle();
    if (data) setClub(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchClub();
  }, []);

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
    name: club?.name ?? FALLBACK_NAME,
    tagline: club?.tagline ?? null,
    logoUrl,
    loading,
    refetch: fetchClub,
  };

  return <ClubBrandingContext.Provider value={value}>{children}</ClubBrandingContext.Provider>;
};
