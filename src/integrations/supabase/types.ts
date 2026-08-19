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
          detail_stats: Json
          id: string
          match_id: string | null
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
          detail_stats?: Json
          id?: string
          match_id?: string | null
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
          detail_stats?: Json
          id?: string
          match_id?: string | null
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
            foreignKeyName: "games_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments_public"
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
      game_legs: {
        Row: {
          created_at: string
          game_id: string
          id: string
          leg_number: number
          player_id: string | null
          player_index: number
          player_name: string
          starting_score: number
          throws: Json
          user_id: string
          won: boolean
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          leg_number: number
          player_id?: string | null
          player_index: number
          player_name: string
          starting_score: number
          throws?: Json
          user_id: string
          won?: boolean
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          leg_number?: number
          player_id?: string | null
          player_index?: number
          player_name?: string
          starting_score?: number
          throws?: Json
          user_id?: string
          won?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "game_legs_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_legs_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      highlight_clips: {
        Row: {
          created_at: string
          darts: Json
          game_id: string | null
          id: string
          kind: string
          mime: string
          player_id: string | null
          player_name: string
          points: number
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          darts?: Json
          game_id?: string | null
          id?: string
          kind: string
          mime?: string
          player_id?: string | null
          player_name: string
          points?: number
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          darts?: Json
          game_id?: string | null
          id?: string
          kind?: string
          mime?: string
          player_id?: string | null
          player_name?: string
          points?: number
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "highlight_clips_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_180_entries: {
        Row: {
          count: number
          created_at: string
          id: string
          player_id: string
          year: number
        }
        Insert: {
          count: number
          created_at?: string
          id?: string
          player_id: string
          year: number
        }
        Update: {
          count?: number
          created_at?: string
          id?: string
          player_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "manual_180_entries_player_id_fkey"
            columns: ["player_id"]
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
          elo_rating: number
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
          elo_rating?: number
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
          elo_rating?: number
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
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
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
          boards: number
          bracket: Json
          champion: string | null
          created_at: string
          game_mode: string
          id: string
          live_play_enabled: boolean
          max_rounds_x01: number | null
          mode: string
          name: string
          players: Json
          public_slug: string | null
          public_view: boolean
          round_configs: Json
          series_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          best_of_legs?: number
          boards?: number
          bracket?: Json
          champion?: string | null
          created_at?: string
          game_mode?: string
          id?: string
          live_play_enabled?: boolean
          max_rounds_x01?: number | null
          mode?: string
          name: string
          players?: Json
          public_slug?: string | null
          public_view?: boolean
          round_configs?: Json
          series_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          best_of_legs?: number
          boards?: number
          bracket?: Json
          champion?: string | null
          created_at?: string
          game_mode?: string
          id?: string
          live_play_enabled?: boolean
          max_rounds_x01?: number | null
          mode?: string
          name?: string
          players?: Json
          public_slug?: string | null
          public_view?: boolean
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
      training_samples: {
        Row: {
          after_path: string
          before_path: string
          board: string
          calib_taps: Json | null
          camera_zoom: number | null
          created_at: string
          id: string
          image_size: number
          labels: Json
          user_id: string
        }
        Insert: {
          after_path: string
          before_path: string
          board?: string
          calib_taps?: Json | null
          camera_zoom?: number | null
          created_at?: string
          id?: string
          image_size?: number
          labels?: Json
          user_id: string
        }
        Update: {
          after_path?: string
          before_path?: string
          board?: string
          calib_taps?: Json | null
          camera_zoom?: number | null
          created_at?: string
          id?: string
          image_size?: number
          labels?: Json
          user_id?: string
        }
        Relationships: []
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
      tournaments_public: {
        Row: {
          best_of_legs: number | null
          boards: number | null
          bracket: Json | null
          champion: string | null
          game_mode: string | null
          id: string | null
          mode: string | null
          name: string | null
          players: Json | null
          public_slug: string | null
          public_view: boolean | null
          round_configs: Json | null
          status: string | null
        }
        Insert: {
          best_of_legs?: number | null
          boards?: number | null
          bracket?: Json | null
          champion?: string | null
          game_mode?: string | null
          id?: string | null
          mode?: string | null
          name?: string | null
          players?: Json | null
          public_slug?: string | null
          public_view?: boolean | null
          round_configs?: Json | null
          status?: string | null
        }
        Update: {
          best_of_legs?: number | null
          boards?: number | null
          bracket?: Json | null
          champion?: string | null
          game_mode?: string | null
          id?: string | null
          mode?: string | null
          name?: string | null
          players?: Json | null
          public_slug?: string | null
          public_view?: boolean | null
          round_configs?: Json | null
          status?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      update_match_live_snapshot: { Args: { p_tournament_id: string; p_match_id: string; p_snapshot: Json }; Returns: undefined }
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
      admin_user_activity: {
        Args: never
        Returns: {
          average: number
          created_at: string
          email: string
          games_played: number
          last_sign_in_at: string
          player_name: string
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
      public_tournament_highlights: {
        Args: { _tournament_id: string }
        Returns: {
          player_id: string | null
          player_name: string
          starting_score: number
          throws: Json
          won: boolean
          game_id: string
          player1_id: string | null
          player1_name: string
          player1_average: number
          player2_id: string | null
          player2_name: string
          player2_average: number
        }[]
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
