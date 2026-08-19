import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
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

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
  </div>
);

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

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/live/:slug" element={<PublicTournament />} />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Suspense fallback={<RouteFallback />}>
                        <Routes>
                          <Route path="/" element={<Index />} />
                          <Route path="/players" element={<Players />} />
                          <Route path="/game" element={<Game />} />
                          <Route path="/tournament" element={<Tournament />} />
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
                  </ProtectedRoute>
                }
              />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </ThemeProvider>
);

export default App;
