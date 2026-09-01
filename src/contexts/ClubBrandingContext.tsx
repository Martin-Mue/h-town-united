import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { resolveClubTheme, DEFAULT_CLUB_THEME_PRESET_ID } from "@/lib/clubThemePresets";
import htuLogoFallback from "@/assets/htu-logo.jpg";

// Personal color override: local to this browser only (not synced anywhere), so one member
// picking a different preset can never change what anyone else sees -- deliberately simpler than
// a DB column for exactly that reason (see the user's own framing: "solange eine Änderung von
// jemand anderem meinen Login bzw. meine Ansicht nicht ändert"). Only the 3 accent colors are
// personal; name/logo/tagline stay admin-only and club-wide, untouched by this.
const PERSONAL_THEME_KEY = "dart-personal-theme-preset";

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
  /** This browser's personal color override (see PERSONAL_THEME_KEY above), or null when using
   *  the club's own default. Never the club's theme_preset itself -- that stays admin-only. */
  personalThemePreset: string | null;
  /** Pass null to clear the override and go back to the club default. */
  setPersonalThemePreset: (presetId: string | null) => void;
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
  personalThemePreset: null,
  setPersonalThemePreset: () => {},
});

export const useClubBranding = () => useContext(ClubBrandingContext);

export const ClubBrandingProvider = ({ children }: { children: ReactNode }) => {
  const [club, setClub] = useState<ClubRow | null>(null);
  const [status, setStatus] = useState<MembershipStatus>("loading");
  const { resolvedTheme } = useTheme();
  const { user, loading: authLoading } = useAuth();

  const [personalThemePreset, setPersonalThemePresetState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(PERSONAL_THEME_KEY);
  });
  const setPersonalThemePreset = (presetId: string | null) => {
    setPersonalThemePresetState(presetId);
    if (typeof window === "undefined") return;
    if (presetId) window.localStorage.setItem(PERSONAL_THEME_KEY, presetId);
    else window.localStorage.removeItem(PERSONAL_THEME_KEY);
  };

  // Guards against out-of-order responses: e.g. onAuthStateChange's INITIAL_SESSION callback and
  // AuthContext's own getSession() call can each independently flip `user`/`authLoading`, firing
  // fetchClub twice in close succession. Without this, a slower first call resolving AFTER a
  // faster second call would silently overwrite the correct result with a stale one -- including
  // the one-tick "resolved, no club" case that's enough to strand an existing member on
  // /create-club (see the safety-net redirect in CreateClub.tsx for the other half of this fix).
  const requestIdRef = useRef(0);

  const fetchClub = async () => {
    const requestId = ++requestIdRef.current;
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
      if (requestId !== requestIdRef.current) return;
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
      if (requestId !== requestIdRef.current) return;
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
    if (requestId !== requestIdRef.current) return;
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

  // Re-apply CSS vars whenever the preset or the resolved light/dark mode changes. The personal
  // override (this browser only) wins over the club's own admin-set default when present.
  useEffect(() => {
    const mode = resolvedTheme === "light" ? "light" : "dark";
    const vars = resolveClubTheme(personalThemePreset ?? club?.theme_preset ?? DEFAULT_CLUB_THEME_PRESET_ID, mode);
    const root = document.documentElement.style;
    Object.entries(vars).forEach(([key, value]) => root.setProperty(key, value));
  }, [club?.theme_preset, personalThemePreset, resolvedTheme]);

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
    personalThemePreset,
    setPersonalThemePreset,
  };

  return <ClubBrandingContext.Provider value={value}>{children}</ClubBrandingContext.Provider>;
};
