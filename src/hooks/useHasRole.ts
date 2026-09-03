import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

/** Whether the given user holds a specific role — same shape as useIsAdmin.ts (kept as its own
 *  file rather than merging the two, matching that hook's own doc comment on why this codebase
 *  tolerates a little duplication here over a shared abstraction). Fetches all of the user's
 *  roles and checks client-side, not a single filtered query — a user can hold several roles at
 *  once (member + editor + admin), see the UNIQUE(user_id, role) model. */
export function useHasRole(userId: string | undefined | null, role: AppRole): boolean {
  const [hasRole, setHasRole] = useState(false);

  useEffect(() => {
    if (!userId) {
      setHasRole(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .then(({ data }) => {
        if (!cancelled) setHasRole(!!data?.some((r) => r.role === role));
      });
    return () => {
      cancelled = true;
    };
  }, [userId, role]);

  return hasRole;
}
