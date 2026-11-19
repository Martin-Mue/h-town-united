import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { queryClient } from "@/lib/queryClient";
import { unsubscribeFromPush } from "@/lib/push";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Data cached for one account (roster, statistics, …) must not show for the next one on the same device.
  const cachedForUserRef = useRef<string | null | undefined>(undefined);
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (loading) return;
    if (cachedForUserRef.current !== undefined && cachedForUserRef.current !== userId) queryClient.clear();
    cachedForUserRef.current = userId;
  }, [userId, loading]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    // Pushes belong to the account, not the phone: without this the next person signing in here got the previous
    // member's "your match is next". Done before signing out, while the session may still delete its own row.
    try {
      await Promise.race([unsubscribeFromPush(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    } catch {
      // signing out must work even when this fails
    }
    await supabase.auth.signOut();
    queryClient.clear();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
