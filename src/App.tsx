import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LanguageProvider, useLanguage } from "@/contexts/LanguageContext";
import { ClubBrandingProvider, useClubBranding } from "@/contexts/ClubBrandingContext";
import Layout from "./components/Layout";
import Auth from "./pages/Auth";
import { Loader2 } from "lucide-react";

// Route-level code splitting — each page becomes its own chunk, loaded on first visit
// instead of all being bundled into the initial page load. `Auth` stays eager since it's
// the very first thing a logged-out visitor sees and shouldn't wait on a second round-trip.
const Index = lazy(() => import("./pages/Index"));
const Players = lazy(() => import("./pages/Players"));
const Game = lazy(() => import("./pages/Game"));
const Tournament = lazy(() => import("./pages/Tournament"));
const Training = lazy(() => import("./pages/Training"));
const Statistics = lazy(() => import("./pages/Statistics"));
const NotFound = lazy(() => import("./pages/NotFound"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Admin = lazy(() => import("./pages/Admin"));
const TournamentSeries = lazy(() => import("./pages/TournamentSeries"));
const PublicTournament = lazy(() => import("./pages/PublicTournament"));
const Settings = lazy(() => import("./pages/Settings"));
const CreateClub = lazy(() => import("./pages/CreateClub"));
const InvitePage = lazy(() => import("./pages/InvitePage"));
const JoinClubPage = lazy(() => import("./pages/JoinClubPage"));

const RouteFallback = () => {
  const { t } = useLanguage();
  return (
    <div role="status" aria-label={t("common.loading")} className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <RouteFallback />;
  // Carries the original URL (e.g. a "Spiel starten" QR link's /game?tid=...&mid=...) through
  // the login detour — without this, scanning that QR while logged out silently dropped straight
  // to the homepage after signing in, losing which match it was meant to prefill.
  if (!user) return <Navigate to="/auth" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <>{children}</>;
};

/** Gates the main app behind club membership, inside ProtectedRoute (needs a session first).
 *  An authenticated account with no club yet (fresh signup, not via an invite) lands on
 *  /create-club instead -- see ClubBrandingContext's fetchClub for why `club` is reliably null
 *  in exactly this case, not silently defaulted to some other club. */
const RequireClub = ({ children }: { children: React.ReactNode }) => {
  const { club, loading } = useClubBranding();
  if (loading) return <RouteFallback />;
  if (!club) return <Navigate to="/create-club" replace />;
  return <>{children}</>;
};

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
    <LanguageProvider>
    <AuthProvider>
    <ClubBrandingProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/live/:slug" element={<PublicTournament />} />
              <Route path="/invite/:token" element={<InvitePage />} />
              <Route path="/join/:clubId" element={<JoinClubPage />} />
              <Route path="/create-club" element={<ProtectedRoute><CreateClub /></ProtectedRoute>} />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <RequireClub>
                    <Layout>
                      <Suspense fallback={<RouteFallback />}>
                        <Routes>
                          <Route path="/" element={<Index />} />
                          <Route path="/players" element={<Players />} />
                          <Route path="/game" element={<Game />} />
                          <Route path="/tournament" element={<Tournament />} />
                          <Route path="/tournament/:id" element={<Tournament />} />
                          <Route path="/tournaments/series" element={<TournamentSeries />} />
                          <Route path="/tournaments/series/:id" element={<TournamentSeries />} />
                          <Route path="/training" element={<Training />} />
                          <Route path="/statistics" element={<Statistics />} />
                          <Route path="/admin" element={<Admin />} />
                          <Route path="/settings" element={<Settings />} />
                          <Route path="*" element={<NotFound />} />
                        </Routes>
                      </Suspense>
                    </Layout>
                    </RequireClub>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </ClubBrandingProvider>
    </AuthProvider>
    </LanguageProvider>
  </ThemeProvider>
);

export default App;
