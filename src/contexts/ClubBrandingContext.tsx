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

/** "loading": fetch in flight or not started -- club may still be stale/null, never act on it.
 *  "resolved": the fetch genuinely succeeded -- club is either the caller's real club, or
 *  legitimately null (no membership row, no error). Only THIS status may drive a redirect.
 *  "error": the fetch itself failed (network, RLS hiccup, ...) -- treat exactly like "loading",
 *  never like "resolved with no club". */
type MembershipStatus = "loading" | "resolved" | "error";

interface ClubBrandingContextType {
  club: ClubRow | null;
  clubId: string | null;
  name: string;
  tagline: string | null;
  logoUrl: string;
  loading: boolean;
  /** True once fetchClub has genuinely completed (success or legitimate empty result) for the
   *  CURRENT user -- the only condition under which App.tsx's RequireClub may act on `club`. */
  resolved: boolean;
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
  resolved: false,
  refetch: async () => {},
});

export const useClubBranding = () => useContext(ClubBrandingContext);

export const ClubBrandingProvider = ({ children }: { children: ReactNode }) => {
  const [club, setClub] = useState<ClubRow | null>(null);
  const [status, setStatus] = useState<MembershipStatus>("loading");
  const { resolvedTheme } = useTheme();
  const { user, loading: authLoading } = useAuth();

  const fetchClub = async () => {
    setStatus("loading");
    if (user) {
      // Authenticated: resolve the caller's OWN club via their membership row, not just
      // "whichever club happens to exist" -- this is what makes branding correct once a
      // second club exists. Two plain queries (not a PostgREST embed) to match this codebase's
      // existing convention of joining client-side rather than relying on embedded selects.
      //
      // Deliberately simple and linear (no retry timer) -- App.tsx's RequireClub only ever
      // redirects to /create-club when status is explicitly "resolved", so an error here just
      // leaves status at "error" (treated identically to "loading" by every consumer) rather
      // than needing its own recovery logic; refetch() (called on window focus, see below)
      // naturally retries on the next opportunity.
      const { data: roleRow, error: roleError } = await supabase.from("user_roles").select("club_id").eq("user_id", user.id).maybeSingle();
      if (roleError) {
        setStatus("error");
        return;
      }
      if (!roleRow?.club_id) {
        // Genuinely no membership row (mid-onboarding, right after signup, before /create-club
        // or an invite has run) -- the ONE legitimate path to a "resolved, no club" state.
        setClub(null);
        setStatus("resolved");
        return;
      }
      const { data: clubRow, error: clubError } = await supabase.from("clubs").select("*").eq("id", roleRow.club_id).maybeSingle();
      if (clubError) {
        setStatus("error");
        return;
      }
      setClub(clubRow ?? null);
      setStatus("resolved");
      return;
    }
    // Anonymous visitor: reads the public-safe view (the base `clubs` table's SELECT is
    // authenticated-members-only, see the plan_tier migration) -- today there's only ever one
    // club, so this always resolves to it, same behavior as before this rework. Once a real
    // multi-club landing exists for a cold, un-invited visitor, this is the spot to swap in a
    // neutral, non-club-specific identity instead.
    const { data } = await supabase.from("clubs_public").select("*").limit(1).maybeSingle();
    if (data) setClub(data);
    setStatus("resolved");
  };

  useEffect(() => {
    if (authLoading) return;
    fetchClub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  // Self-heals a transient "error" status (flaky connection, RLS hiccup) the next time the tab
  // becomes active again, without needing a manual refresh -- otherwise a member who hit an error
  // once would stay stuck on the loading fallback (safe, but not great) until something else
  // happened to remount the provider.
  useEffect(() => {
    if (status !== "error") return;
    const onFocus = () => fetchClub();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

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
    loading: status === "loading",
    resolved: status === "resolved",
    refetch: fetchClub,
  };

  return <ClubBrandingContext.Provider value={value}>{children}</ClubBrandingContext.Provider>;
};
