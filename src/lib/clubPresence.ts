import { useEffect, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";

/** Who is in the app right now — Supabase Realtime Presence on one channel per club, no database
 *  table (presence vanishes by itself when a tab closes, which is exactly the semantics wanted).
 *  The channel is a module singleton: Layout keeps this device on it for as long as the app is
 *  open (useTrackClubPresence), any screen can read the set (useOnlineUserIds). */
let channel: RealtimeChannel | null = null;
let channelKey = "";
let onlineIds: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function join(clubId: string, userId: string) {
  const key = `${clubId}:${userId}`;
  if (channel && channelKey === key) return;
  leave();
  channelKey = key;
  const ch = supabase.channel(`club-presence-${clubId}`, { config: { presence: { key: userId } } });
  ch.on("presence", { event: "sync" }, () => {
    onlineIds = new Set(Object.keys(ch.presenceState()));
    emit();
  });
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") void ch.track({ online_at: new Date().toISOString() });
  });
  channel = ch;
}

function leave() {
  if (channel) { void supabase.removeChannel(channel); channel = null; }
  channelKey = "";
  onlineIds = new Set();
  emit();
}

/** Mount once (Layout): puts the signed-in member on their club's presence channel. */
export function useTrackClubPresence() {
  const { user } = useAuth();
  const { clubId } = useClubBranding();
  useEffect(() => {
    if (!user?.id || !clubId) { leave(); return; }
    join(clubId, user.id);
    return () => { /* kept alive across route changes; torn down on sign-out via the branch above */ };
  }, [user?.id, clubId]);
}

/** User ids currently online in this club (always includes yourself once tracked). */
export function useOnlineUserIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => onlineIds,
    () => onlineIds,
  );
}
