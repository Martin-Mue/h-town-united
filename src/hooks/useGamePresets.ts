import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { normalizePresetConfig } from "@/utils/gamePreset";
import { normalizeTournamentTemplate } from "@/utils/tournamentTemplate";
import type { Json } from "@/integrations/supabase/types";

/** The signed-in account's saved quick-game setups (table game_presets, readable and writable only by its owner). */
export function useGamePresets() {
  return usePresets("game", normalizePresetConfig);
}

/** Saved tournament templates of the signed-in account (same table, kind = tournament). */
export function useTournamentTemplates() {
  return usePresets("tournament", normalizeTournamentTemplate);
}

function usePresets<T>(kind: "game" | "tournament", normalize: (raw: unknown) => T) {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();
  const queryKey = ["game-presets", kind, userId] as const;

  const { data: presets = [] } = useQuery({
    queryKey,
    enabled: !!userId,
    queryFn: async (): Promise<{ id: string; name: string; config: T }[]> => {
      const { data, error } = await supabase.from("game_presets").select("id, name, config").eq("kind", kind).order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => ({ id: row.id, name: row.name, config: normalize(row.config) }));
    },
  });

  const savePreset = useCallback(async (name: string, config: T): Promise<string | null> => {
    if (!userId) return "not signed in";
    const { error } = await supabase.from("game_presets").insert({ user_id: userId, kind, name: name.trim(), config: config as unknown as Json });
    if (error) return error.message;
    await queryClient.invalidateQueries({ queryKey });
    return null;
  }, [userId, kind, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  const deletePreset = useCallback(async (id: string): Promise<string | null> => {
    const { error } = await supabase.from("game_presets").delete().eq("id", id);
    if (error) return error.message;
    await queryClient.invalidateQueries({ queryKey });
    return null;
  }, [kind, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  return { presets, signedIn: !!userId, savePreset, deletePreset };
}
