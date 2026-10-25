import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { normalizePresetConfig, type GamePresetConfig } from "@/utils/gamePreset";
import type { Json } from "@/integrations/supabase/types";

export interface GamePreset {
  id: string;
  name: string;
  config: GamePresetConfig;
}

/** The signed-in account's saved quick-game setups (table game_presets, readable and writable only by its owner). */
export function useGamePresets() {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();
  const queryKey = ["game-presets", userId] as const;

  const { data: presets = [] } = useQuery({
    queryKey,
    enabled: !!userId,
    queryFn: async (): Promise<GamePreset[]> => {
      const { data, error } = await supabase.from("game_presets").select("id, name, config").order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => ({ id: row.id, name: row.name, config: normalizePresetConfig(row.config) }));
    },
  });

  const savePreset = useCallback(async (name: string, config: GamePresetConfig): Promise<string | null> => {
    if (!userId) return "not signed in";
    const { error } = await supabase.from("game_presets").insert({ user_id: userId, name: name.trim(), config: config as unknown as Json });
    if (error) return error.message;
    await queryClient.invalidateQueries({ queryKey });
    return null;
  }, [userId, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  const deletePreset = useCallback(async (id: string): Promise<string | null> => {
    const { error } = await supabase.from("game_presets").delete().eq("id", id);
    if (error) return error.message;
    await queryClient.invalidateQueries({ queryKey });
    return null;
  }, [queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  return { presets, signedIn: !!userId, savePreset, deletePreset };
}
