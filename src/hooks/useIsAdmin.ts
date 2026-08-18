import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Whether the given user has the "admin" role. Layout.tsx and Players.tsx each reimplemented
 * this identically; Admin.tsx has its own copy too but is left alone here — there, the check is
 * tightly coupled with fetching the full admin user list (re-triggered after every role grant/
 * revoke/delete), and untangling that carries more risk than this dedup is worth.
 *
 * Fetches all of the user's roles and checks client-side rather than a single filtered
 * `.eq("role", "admin").maybeSingle()` query — the two are only equivalent because of a
 * UNIQUE(user_id, role) DB constraint; this shape doesn't depend on that holding.
 */
export function useIsAdmin(userId: string | undefined | null): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!userId) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .then(({ data }) => {
        if (!cancelled) setIsAdmin(!!data?.some((r) => r.role === "admin"));
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return isAdmin;
}
