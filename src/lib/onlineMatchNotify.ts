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

export function notifyChallengeCreated(opponentUserId: string, challengerName: string, mode: "501" | "301" | "cricket" | "custom"): void {
  const modeLabel = mode === "cricket" ? "Cricket" : mode === "custom" ? "Custom" : mode;
  sendPush(opponentUserId, "Neue Herausforderung", `${challengerName} hat dich zu einem ${modeLabel}-Match herausgefordert.`);
}

export function notifyChallengeDeclined(challengerUserId: string, declinerName: string, reason?: string): void {
  const body = reason ? `${declinerName} hat abgelehnt: „${reason}“` : `${declinerName} hat deine Herausforderung abgelehnt.`;
  sendPush(challengerUserId, "Herausforderung abgelehnt", body);
}

/** Doubles invitation: one push to each of the three invited players (partner + two opponents). */
export function notifyDoublesInvited(userIds: string[], challengerName: string, mode: "501" | "301" | "cricket" | "custom"): void {
  const modeLabel = mode === "cricket" ? "Cricket" : mode === "custom" ? "Custom" : mode;
  userIds.forEach((id) => sendPush(id, "Doppel-Einladung", `${challengerName} lädt dich zu einem ${modeLabel}-Doppel ein – alle spielen von zu Hause.`));
}

/** One player declining cancels the whole doubles lobby — everyone else hears about it. */
export function notifyDoublesDeclined(userId: string, declinerName: string, reason?: string): void {
  const body = reason ? `${declinerName} hat das Doppel abgesagt: „${reason}“` : `${declinerName} hat das Doppel abgesagt.`;
  sendPush(userId, "Doppel abgesagt", body);
}

/** The last seat accepted — the match is live. */
export function notifyDoublesStarted(userIds: string[]): void {
  userIds.forEach((id) => sendPush(id, "Doppel startet", "Alle haben zugesagt – das Doppel läuft jetzt."));
}

/** Fernduell (asynchronous) - see online_duels. */
export function notifyDuelChallenge(opponentUserId: string, challengerName: string): void {
  sendPush(opponentUserId, "Fernduell", `${challengerName} fordert dich zum Fernduell heraus – spiel es, wann du willst (7 Tage Zeit).`);
}

export function notifyDuelDeclined(challengerUserId: string, declinerName: string, reason?: string): void {
  sendPush(challengerUserId, "Fernduell abgelehnt", reason ? `${declinerName} hat abgelehnt: „${reason}“` : `${declinerName} hat dein Fernduell abgelehnt.`);
}

/** Sent when one side has played: the other side is now on the clock (or, if both are done, sees the result). */
export function notifyDuelPlayed(otherUserId: string, playerName: string, finished: boolean): void {
  sendPush(
    otherUserId,
    finished ? "Fernduell entschieden" : "Fernduell: du bist dran",
    finished ? `${playerName} und du habt gespielt – das Ergebnis steht in der App.` : `${playerName} hat das Fernduell gespielt. Jetzt bist du dran!`,
  );
}
