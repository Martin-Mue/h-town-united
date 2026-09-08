import { QueryClient } from "@tanstack/react-query";

/**
 * Shared React Query client (Round 3 Rang 4: "Spielerliste wird auf mehreren Seiten unabhängig
 * und ungecacht neu geladen" — Index/League/Tournament/Game/OnlineChallengeSetup each fired their
 * own fetchClubPlayers() on mount with no cache between them, so navigating Index → Game →
 * Tournament during one club night re-issued the same `players` SELECT every single time).
 *
 * staleTime of 60s is deliberately short, not "cache forever": this schema has no realtime
 * subscription on the players table (unlike tournaments' bracket), so a genuinely fresh join or
 * stat update elsewhere in the app is only ever picked up on the next natural refetch (a fresh
 * mount past staleTime, or an explicit invalidateQueries after a mutation) — 60s keeps that lag
 * short without defeating the whole point of caching for a page-to-page navigation that happens
 * in seconds. gcTime intentionally left at the library default (5 min) — long enough that quick
 * back-and-forth navigation between pages still hits cache even once "stale".
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});
