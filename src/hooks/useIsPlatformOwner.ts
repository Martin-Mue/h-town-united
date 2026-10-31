import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Whether the signed-in account is an operator of the whole app (public.platform_owners) rather than
 *  just an admin of one club. Decides who sees the analysis areas of the admin page (usage, AI trainer,
 *  statistics). The server answers per call; the usage_overview function checks it again on its own. */
export function useIsPlatformOwner(userId: string | undefined | null): boolean | null {
  const [owner, setOwner] = useState<boolean | null>(null);

  useEffect(() => {
    if (!userId) { setOwner(false); return; }
    let cancelled = false;
    supabase.rpc("is_platform_owner").then(({ data, error }) => {
      if (!cancelled) setOwner(error ? false : !!data);
    });
    return () => { cancelled = true; };
  }, [userId]);

  return owner;
}
