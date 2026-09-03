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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      club_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          club_id: string
          created_at: string
          created_by: string
          email: string
          expires_at: string
          id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          club_id: string
          created_at?: string
          created_by: string
          email: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          club_id?: string
          created_at?: string
          created_by?: string
          email?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_invites_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_invites_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      club_join_requests: {
        Row: {
          club_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          status: string
          user_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          status?: string
          user_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_join_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_join_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      clubs: {
        Row: {
          created_at: string
          id: string
          logo_path: string | null
          name: string
          plan_status: string
          plan_tier: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tagline: string | null
          theme_preset: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_path?: string | null
          name: string
          plan_status?: string
          plan_tier?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tagline?: string | null
          theme_preset?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_path?: string | null
          name?: string
          plan_status?: string
          plan_tier?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tagline?: string | null
          theme_preset?: string
          updated_at?: string
        }
        Relationships: []
      }
      game_legs: {
        Row: {
          club_id: string | null
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
          club_id?: string | null
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
          club_id?: string | null
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
            foreignKeyName: "game_legs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_legs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
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
      games: {
        Row: {
          best_of_legs: number
          club_id: string | null
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
          stats_applied: boolean
          tournament_id: string | null
          user_id: string
          winner_id: string | null
          winner_name: string
        }
        Insert: {
          best_of_legs?: number
          club_id?: string | null
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
          stats_applied?: boolean
          tournament_id?: string | null
          user_id: string
          winner_id?: string | null
          winner_name: string
        }
        Update: {
          best_of_legs?: number
          club_id?: string | null
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
          stats_applied?: boolean
          tournament_id?: string | null
          user_id?: string
          winner_id?: string | null
          winner_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "games_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
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
      highlight_clips: {
        Row: {
          club_id: string | null
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
          club_id?: string | null
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
          club_id?: string | null
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
            foreignKeyName: "highlight_clips_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "highlight_clips_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "highlight_clips_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      impressum: {
        Row: {
          address: string
          city: string
          club_id: string | null
          club_name: string
          email: string
          id: string
          phone: string
          register_info: string
          represented_by: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string
          city?: string
          club_id?: string | null
          club_name?: string
          email?: string
          id?: string
          phone?: string
          register_info?: string
          represented_by?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string
          city?: string
          club_id?: string | null
          club_name?: string
          email?: string
          id?: string
          phone?: string
          register_info?: string
          represented_by?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "impressum_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impressum_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      league_fixtures: {
        Row: {
          club_id: string
          created_at: string
          game_id: string | null
          id: string
          league_id: string
          leg: string
          played_at: string | null
          player1_id: string
          player1_legs_won: number | null
          player2_id: string
          player2_legs_won: number | null
          round_number: number
          status: string
          winner_id: string | null
        }
        Insert: {
          club_id?: string
          created_at?: string
          game_id?: string | null
          id?: string
          league_id: string
          leg?: string
          played_at?: string | null
          player1_id: string
          player1_legs_won?: number | null
          player2_id: string
          player2_legs_won?: number | null
          round_number: number
          status?: string
          winner_id?: string | null
        }
        Update: {
          club_id?: string
          created_at?: string
          game_id?: string | null
          id?: string
          league_id?: string
          leg?: string
          played_at?: string | null
          player1_id?: string
          player1_legs_won?: number | null
          player2_id?: string
          player2_legs_won?: number | null
          round_number?: number
          status?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "league_fixtures_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_fixtures_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_fixtures_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_fixtures_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_fixtures_player1_id_fkey"
            columns: ["player1_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_fixtures_player2_id_fkey"
            columns: ["player2_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_fixtures_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          best_of_legs: number
          club_id: string
          created_at: string
          created_by: string
          format: string
          game_mode: string
          id: string
          name: string
          participant_ids: string[]
          result_mode: string
          status: string
          updated_at: string
        }
        Insert: {
          best_of_legs?: number
          club_id?: string
          created_at?: string
          created_by?: string
          format?: string
          game_mode?: string
          id?: string
          name: string
          participant_ids?: string[]
          result_mode?: string
          status?: string
          updated_at?: string
        }
        Update: {
          best_of_legs?: number
          club_id?: string
          created_at?: string
          created_by?: string
          format?: string
          game_mode?: string
          id?: string
          name?: string
          participant_ids?: string[]
          result_mode?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leagues_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leagues_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_180_entries: {
        Row: {
          club_id: string | null
          count: number
          created_at: string
          id: string
          player_id: string
          year: number
        }
        Insert: {
          club_id?: string | null
          count: number
          created_at?: string
          id?: string
          player_id: string
          year: number
        }
        Update: {
          club_id?: string | null
          count?: number
          created_at?: string
          id?: string
          player_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "manual_180_entries_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_180_entries_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_180_entries_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      match_predictions: {
        Row: {
          club_id: string | null
          created_at: string
          id: string
          match_id: string
          predicted_winner: string
          tournament_id: string
          updated_at: string
          voter_id: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          id?: string
          match_id: string
          predicted_winner: string
          tournament_id: string
          updated_at?: string
          voter_id: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          id?: string
          match_id?: string
          predicted_winner?: string
          tournament_id?: string
          updated_at?: string
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_predictions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_predictions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_predictions_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_predictions_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments_public"
            referencedColumns: ["id"]
          },
        ]
      }
      online_matches: {
        Row: {
          best_of_legs: number
          club_id: string
          created_at: string
          created_by: string
          game_state: Json | null
          id: string
          mode: string
          player1_user_id: string
          player2_user_id: string
          source_id: string | null
          source_type: string
          status: string
          updated_at: string
        }
        Insert: {
          best_of_legs?: number
          club_id: string
          created_at?: string
          created_by: string
          game_state?: Json | null
          id?: string
          mode: string
          player1_user_id: string
          player2_user_id: string
          source_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
        }
        Update: {
          best_of_legs?: number
          club_id?: string
          created_at?: string
          created_by?: string
          game_state?: Json | null
          id?: string
          mode?: string
          player1_user_id?: string
          player2_user_id?: string
          source_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_matches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_matches_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
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
          club_id: string | null
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
          club_id?: string | null
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
          club_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "players_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "players_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          club_id: string | null
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          club_id?: string | null
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          club_id?: string | null
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_series: {
        Row: {
          club_id: string | null
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
          club_id?: string | null
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
          club_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          scoring?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_series_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_series_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          attendance: Json
          best_of_legs: number
          boards: number
          bracket: Json
          champion: string | null
          club_id: string | null
          created_at: string
          game_mode: string
          id: string
          live_play_enabled: boolean
          manual_release: boolean
          max_rounds_x01: number | null
          mode: string
          name: string
          players: Json
          prestart_views: Json
          public_slug: string | null
          public_view: boolean
          round_configs: Json
          series_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attendance?: Json
          best_of_legs?: number
          boards?: number
          bracket?: Json
          champion?: string | null
          club_id?: string | null
          created_at?: string
          game_mode?: string
          id?: string
          live_play_enabled?: boolean
          manual_release?: boolean
          max_rounds_x01?: number | null
          mode?: string
          name: string
          players?: Json
          prestart_views?: Json
          public_slug?: string | null
          public_view?: boolean
          round_configs?: Json
          series_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attendance?: Json
          best_of_legs?: number
          boards?: number
          bracket?: Json
          champion?: string | null
          club_id?: string | null
          created_at?: string
          game_mode?: string
          id?: string
          live_play_enabled?: boolean
          manual_release?: boolean
          max_rounds_x01?: number | null
          mode?: string
          name?: string
          players?: Json
          prestart_views?: Json
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
            foreignKeyName: "tournaments_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournaments_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
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
          club_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      clubs_public: {
        Row: {
          id: string | null
          logo_path: string | null
          name: string | null
          tagline: string | null
          theme_preset: string | null
        }
        Insert: {
          id?: string | null
          logo_path?: string | null
          name?: string | null
          tagline?: string | null
          theme_preset?: string | null
        }
        Update: {
          id?: string | null
          logo_path?: string | null
          name?: string | null
          tagline?: string | null
          theme_preset?: string | null
        }
        Relationships: []
      }
      tournaments_public: {
        Row: {
          attendance: Json | null
          best_of_legs: number | null
          boards: number | null
          bracket: Json | null
          champion: string | null
          game_mode: string | null
          id: string | null
          manual_release: boolean | null
          mode: string | null
          name: string | null
          players: Json | null
          prestart_views: Json | null
          public_slug: string | null
          public_view: boolean | null
          round_configs: Json | null
          status: string | null
        }
        Insert: {
          attendance?: Json | null
          best_of_legs?: number | null
          boards?: number | null
          bracket?: Json | null
          champion?: string | null
          game_mode?: string | null
          id?: string | null
          manual_release?: boolean | null
          mode?: string | null
          name?: string | null
          players?: Json | null
          prestart_views?: Json | null
          public_slug?: string | null
          public_view?: boolean | null
          round_configs?: Json | null
          status?: string | null
        }
        Update: {
          attendance?: Json | null
          best_of_legs?: number | null
          boards?: number | null
          bracket?: Json | null
          champion?: string | null
          game_mode?: string | null
          id?: string | null
          manual_release?: boolean | null
          mode?: string | null
          name?: string | null
          players?: Json | null
          prestart_views?: Json | null
          public_slug?: string | null
          public_view?: boolean | null
          round_configs?: Json | null
          status?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_club_invite: { Args: { _token: string }; Returns: string }
      accept_online_match: {
        Args: { _initial_game_state: Json; _match_id: string }
        Returns: undefined
      }
      admin_delete_user: { Args: { _user_id: string }; Returns: undefined }
      admin_list_active_tournaments: {
        Args: never
        Returns: {
          attendance: Json
          best_of_legs: number
          boards: number
          bracket: Json
          champion: string | null
          club_id: string | null
          created_at: string
          game_mode: string
          id: string
          live_play_enabled: boolean
          manual_release: boolean
          max_rounds_x01: number | null
          mode: string
          name: string
          players: Json
          prestart_views: Json
          public_slug: string | null
          public_view: boolean
          round_configs: Json
          series_id: string | null
          status: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tournaments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_list_join_requests: {
        Args: never
        Returns: {
          created_at: string
          email: string
          id: string
          user_id: string
        }[]
      }
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
      admin_tournament_forecast_mode_stats: {
        Args: never
        Returns: {
          avg_darts_per_leg: number
          avg_legs_per_match: number
          best_of_legs: number
          leg_count: number
          match_count: number
          mode: string
        }[]
      }
      admin_tournament_forecast_player_stats: {
        Args: never
        Returns: {
          avg_darts_per_leg: number
          leg_count: number
          mode: string
          player_name: string
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
      apply_game_player_stats: {
        Args: { p_game_id: string }
        Returns: undefined
      }
      cast_match_prediction: {
        Args: {
          _match_id: string
          _predicted_winner: string
          _tournament_id: string
          _voter_id: string
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
      create_club: {
        Args: { _name: string; _tagline?: string }
        Returns: string
      }
      current_club_id: { Args: never; Returns: string }
      dart_stats_leg_summary: {
        Args: { p_starting_score: number; p_throws: Json }
        Returns: {
          checkout_attempts: number
          checkout_hits: number
          highest_visit: number
        }[]
      }
      get_invite_preview: {
        Args: { _token: string }
        Returns: {
          already_accepted: boolean
          club_name: string
          expired: boolean
          logo_path: string
          tagline: string
        }[]
      }
      get_match_predictions: {
        Args: { _tournament_id: string }
        Returns: {
          match_id: string
          predicted_winner: string
          votes: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      public_tournament_highlights: {
        Args: { _tournament_id: string }
        Returns: {
          game_id: string
          leg_number: number
          player_id: string
          player_name: string
          player1_average: number
          player1_id: string
          player1_name: string
          player2_average: number
          player2_id: string
          player2_name: string
          starting_score: number
          throws: Json
          won: boolean
        }[]
      }
      request_to_join_club: { Args: { _club_id: string }; Returns: string }
      respond_to_join_request: {
        Args: { _approve: boolean; _request_id: string }
        Returns: undefined
      }
      submit_online_throw: {
        Args: {
          _match_id: string
          _new_darts_this_round: number
          _new_game_state: Json
          _new_turn_start_remaining: number
        }
        Returns: undefined
      }
      update_match_live_snapshot: {
        Args: { p_match_id: string; p_snapshot: Json; p_tournament_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "member" | "editor"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "member", "editor"],
    },
  },
} as const
