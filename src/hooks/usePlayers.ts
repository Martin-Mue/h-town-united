import { useQuery } from "@tanstack/react-query";
import { fetchClubPlayers, type ClubPlayer } from "@/lib/repositories/players";

/** Cache key for the club roster query — exported so a mutation that changes a `players` row
 *  (Players.tsx's own create/edit/delete flow, which still queries independently — see that
 *  file's own doc comment for why it wasn't folded into this hook) can invalidate this cache via
 *  `queryClient.invalidateQueries({ queryKey: PLAYERS_QUERY_KEY })` if it ever needs to force
 *  every other open tab/page to see a change immediately instead of waiting out staleTime. */
export const PLAYERS_QUERY_KEY = ["club-players"] as const;

/**
 * The shared, cached replacement for every page independently calling fetchClubPlayers() on its
 * own mount (Round 3 Rang 4). Same `ClubPlayer[]` shape and the same underlying query as before —
 * this only changes WHERE the fetch is cached, not what it returns, so existing call sites that
 * swap `useState<ClubPlayer[]>([]) + useEffect(() => { fetchClubPlayers().then(setX) }, [])` for
 * `const { data: x = [] } = usePlayers();` keep working unchanged.
 */
export function usePlayers() {
  return useQuery({
    queryKey: PLAYERS_QUERY_KEY,
    queryFn: fetchClubPlayers,
  });
}

export type { ClubPlayer };
