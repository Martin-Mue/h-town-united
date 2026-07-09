export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      games: {
        Row: {
          best_of_legs: number
          created_at: string
          id: string
          mode: string
          played_at: string
          player1_average: number
          player1_double_rate: number
          player1_highscore: number
          player1_id: string | null
          player1_legs_won: number
          player1_name: string
          player1_total_throws: number
          player2_average: number
          player2_double_rate: number
          player2_highscore: number
          player2_id: string | null
          player2_legs_won: number
          player2_name: string
          player2_total_throws: number
          start_score: number
          tournament_id: string | null
          user_id: string
          winner_id: string | null
          winner_name: string
        }
        Insert: {
          best_of_legs?: number
          created_at?: string
          id?: string
          mode?: string
          played_at?: string
          player1_average?: number
          player1_double_rate?: number
          player1_highscore?: number
          player1_id?: string | null
          player1_legs_won?: number
          player1_name: string
          player1_total_throws?: number
          player2_average?: number
          player2_double_rate?: number
          player2_highscore?: number
          player2_id?: string | null
          player2_legs_won?: number
          player2_name: string
          player2_total_throws?: number
          start_score?: number
          tournament_id?: string | null
          user_id: string
          winner_id?: string | null
          winner_name: string
        }
        Update: {
          best_of_legs?: number
          created_at?: string
          id?: string
          mode?: string
          played_at?: string
          player1_average?: number
          player1_double_rate?: number
          player1_highscore?: number
          player1_id?: string | null
          player1_legs_won?: number
          player1_name?: string
          player1_total_throws?: number
          player2_average?: number
          player2_double_rate?: number
          player2_highscore?: number
          player2_id?: string | null
          player2_legs_won?: number
          player2_name?: string
          player2_total_throws?: number
          start_score?: number
          tournament_id?: string | null
          user_id?: string
          winner_id?: string | null
          winner_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "games_player1_id_fkey"
            columns: ["player1_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_player2_id_fkey"
            columns: ["player2_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          ai_portrait_url: string | null
          avatar_url: string | null
          average: number
          bio: string | null
          birthday: string | null
          created_at: string
          dart_weight_g: number | null
          double_rate: number
          emoji: string | null
          favorite_double: string | null
          games_played: number
          games_won: number
          high_score: number
          hometown: string | null
          id: string
          joined_year: number | null
          motto: string | null
          name: string
          nickname: string | null
          throwing_hand: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ai_portrait_url?: string | null
          avatar_url?: string | null
          average?: number
          bio?: string | null
          birthday?: string | null
          created_at?: string
          dart_weight_g?: number | null
          double_rate?: number
          emoji?: string | null
          favorite_double?: string | null
          games_played?: number
          games_won?: number
          high_score?: number
          hometown?: string | null
          id?: string
          joined_year?: number | null
          motto?: string | null
          name: string
          nickname?: string | null
          throwing_hand?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ai_portrait_url?: string | null
          avatar_url?: string | null
          average?: number
          bio?: string | null
          birthday?: string | null
          created_at?: string
          dart_weight_g?: number | null
          double_rate?: number
          emoji?: string | null
          favorite_double?: string | null
          games_played?: number
          games_won?: number
          high_score?: number
          hometown?: string | null
          id?: string
          joined_year?: number | null
          motto?: string | null
          name?: string
          nickname?: string | null
          throwing_hand?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      tournament_series: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          scoring: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          scoring?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          scoring?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tournaments: {
        Row: {
          best_of_legs: number
          bracket: Json
          champion: string | null
          created_at: string
          game_mode: string
          id: string
          max_rounds_x01: number | null
          mode: string
          name: string
          players: Json
          round_configs: Json
          series_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          best_of_legs?: number
          bracket?: Json
          champion?: string | null
          created_at?: string
          game_mode?: string
          id?: string
          max_rounds_x01?: number | null
          mode?: string
          name: string
          players?: Json
          round_configs?: Json
          series_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          best_of_legs?: number
          bracket?: Json
          champion?: string | null
          created_at?: string
          game_mode?: string
          id?: string
          max_rounds_x01?: number | null
          mode?: string
          name?: string
          players?: Json
          round_configs?: Json
          series_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournaments_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "tournament_series"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_delete_user: { Args: { _user_id: string }; Returns: undefined }
      admin_list_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          roles: Database["public"]["Enums"]["app_role"][]
          user_id: string
        }[]
      }
      admin_set_role: {
        Args: {
          _grant: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      club_head_to_head: {
        Args: { _player_a: string; _player_b: string }
        Returns: {
          a_avg: number
          a_wins: number
          b_avg: number
          b_wins: number
          total_games: number
        }[]
      }
      club_leaderboard: {
        Args: never
        Returns: {
          avg_score: number
          emoji: string
          games_played: number
          games_won: number
          highscore: number
          player_id: string
          player_name: string
          win_rate: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "member"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "member"],
    },
  },
} as const
