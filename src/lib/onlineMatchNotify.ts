import { supabase } from "@/integrations/supabase/client";

/** Fire-and-forget push for the online-challenge flow (see online_matches) — mirrors the existing
 *  tournament "match ready" push's own established pattern (buildMatchReadyPush/notifyMatchReady
 *  in utils/tournament.ts). Centralized here since a challenge can now be created from three
 *  independent places (OnlineChallengeSetup.tsx, League.tsx, Tournament.tsx) that would otherwise
 *  each reimplement the same title/body/url shape — exactly the kind of copy that's drifted
 *  elsewhere in this codebase once one call site's needs changed and the others didn't. */
function sendPush(userId: string, title: string, body: string): void {
  supabase.functions.invoke("send-push", { body: { userIds: [userId], title, body, url: "/" } })
    .catch((err) => console.error("online-match push failed", err));
}

export function notifyChallengeCreated(opponentUserId: string, challengerName: string, mode: "501" | "301" | "cricket"): void {
  sendPush(opponentUserId, "Neue Herausforderung", `${challengerName} hat dich zu einem ${mode === "cricket" ? "Cricket" : mode}-Match herausgefordert.`);
}

export function notifyChallengeDeclined(challengerUserId: string, declinerName: string, reason?: string): void {
  const body = reason ? `${declinerName} hat abgelehnt: „${reason}“` : `${declinerName} hat deine Herausforderung abgelehnt.`;
  sendPush(challengerUserId, "Herausforderung abgelehnt", body);
}
