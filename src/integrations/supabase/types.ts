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
      autodarts_boards: {
        Row: {
          access_token: string | null
          access_token_expires_at: string | null
          autodarts_board_id: string | null
          autodarts_user_email: string | null
          board_number: number
          club_id: string
          connection_mode: string
          created_at: string
          id: string
          label: string | null
          last_error: string | null
          last_match_debug: Json | null
          local_api_key_ciphertext: string | null
          local_api_key_iv: string | null
          local_ip: string | null
          pending_login_request_id: number | null
          pending_match_setup: Json | null
          pending_poll_kind: string | null
          pending_poll_request_id: number | null
          refresh_token_ciphertext: string | null
          refresh_token_iv: string | null
          status: string
          token_updated_at: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          access_token_expires_at?: string | null
          autodarts_board_id?: string | null
          autodarts_user_email?: string | null
          board_number: number
          club_id: string
          connection_mode?: string
          created_at?: string
          id?: string
          label?: string | null
          last_error?: string | null
          last_match_debug?: Json | null
          local_api_key_ciphertext?: string | null
          local_api_key_iv?: string | null
          local_ip?: string | null
          pending_login_request_id?: number | null
          pending_match_setup?: Json | null
          pending_poll_kind?: string | null
          pending_poll_request_id?: number | null
          refresh_token_ciphertext?: string | null
          refresh_token_iv?: string | null
          status?: string
          token_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          access_token_expires_at?: string | null
          autodarts_board_id?: string | null
          autodarts_user_email?: string | null
          board_number?: number
          club_id?: string
          connection_mode?: string
          created_at?: string
          id?: string
          label?: string | null
          last_error?: string | null
          last_match_debug?: Json | null
          local_api_key_ciphertext?: string | null
          local_api_key_iv?: string | null
          local_ip?: string | null
          pending_login_request_id?: number | null
          pending_match_setup?: Json | null
          pending_poll_kind?: string | null
          pending_poll_request_id?: number | null
          refresh_token_ciphertext?: string | null
          refresh_token_iv?: string | null
          status?: string
          token_updated_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "autodarts_boards_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autodarts_boards_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
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
          club_id: string
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
          club_id: string
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
          club_id?: string
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
      game_presets: {
        Row: {
          config: Json
          created_at: string
          id: string
          kind: string
          name: string
          user_id: string
        }
        Insert: {
          config: Json
          created_at?: string
          id?: string
          kind?: string
          name: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          kind?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      games: {
        Row: {
          ai_report: string | null
          best_of_legs: number
          best_of_sets: number | null
          club_id: string
          created_at: string
          detail_stats: Json
          id: string
          match_id: string | null
          mode: string
          played_at: string
          played_online: boolean
          player1_average: number
          player1_double_rate: number
          player1_highscore: number
          player1_id: string | null
          player1_legs_won: number
          player1_name: string
          player1_sets_won: number
          player1_total_throws: number
          player2_average: number
          player2_double_rate: number
          player2_highscore: number
          player2_id: string | null
          player2_legs_won: number
          player2_name: string
          player2_sets_won: number
          player2_total_throws: number
          start_score: number
          stats_applied: boolean
          tournament_id: string | null
          user_id: string
          winner_id: string | null
          winner_name: string
        }
        Insert: {
          ai_report?: string | null
          best_of_legs?: number
          best_of_sets?: number | null
          club_id: string
          created_at?: string
          detail_stats?: Json
          id?: string
          match_id?: string | null
          mode?: string
          played_at?: string
          played_online?: boolean
          player1_average?: number
          player1_double_rate?: number
          player1_highscore?: number
          player1_id?: string | null
          player1_legs_won?: number
          player1_name: string
          player1_sets_won?: number
          player1_total_throws?: number
          player2_average?: number
          player2_double_rate?: number
          player2_highscore?: number
          player2_id?: string | null
          player2_legs_won?: number
          player2_name: string
          player2_sets_won?: number
          player2_total_throws?: number
          start_score?: number
          stats_applied?: boolean
          tournament_id?: string | null
          user_id: string
          winner_id?: string | null
          winner_name: string
        }
        Update: {
          ai_report?: string | null
          best_of_legs?: number
          best_of_sets?: number | null
          club_id?: string
          created_at?: string
          detail_stats?: Json
          id?: string
          match_id?: string | null
          mode?: string
          played_at?: string
          played_online?: boolean
          player1_average?: number
          player1_double_rate?: number
          player1_highscore?: number
          player1_id?: string | null
          player1_legs_won?: number
          player1_name?: string
          player1_sets_won?: number
          player1_total_throws?: number
          player2_average?: number
          player2_double_rate?: number
          player2_highscore?: number
          player2_id?: string | null
          player2_legs_won?: number
          player2_name?: string
          player2_sets_won?: number
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
          club_id: string
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
          club_id: string
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
          club_id?: string
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
          player1_name: string | null
          player2_id: string
          player2_legs_won: number | null
          player2_name: string | null
          round_number: number
          scheduled_date: string | null
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
          player1_name?: string | null
          player2_id: string
          player2_legs_won?: number | null
          player2_name?: string | null
          round_number: number
          scheduled_date?: string | null
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
          player1_name?: string | null
          player2_id?: string
          player2_legs_won?: number | null
          player2_name?: string | null
          round_number?: number
          scheduled_date?: string | null
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
            foreignKeyName: "league_fixtures_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues_public"
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
          division_level: number
          division_name: string | null
          format: string
          game_mode: string
          id: string
          name: string
          next_season_league_id: string | null
          participant_ids: string[]
          previous_season_league_id: string | null
          promote_count: number
          public_slug: string | null
          public_view: boolean
          relegate_count: number
          result_mode: string
          season_group_id: string | null
          season_number: number
          status: string
          updated_at: string
        }
        Insert: {
          best_of_legs?: number
          club_id?: string
          created_at?: string
          created_by?: string
          division_level?: number
          division_name?: string | null
          format?: string
          game_mode?: string
          id?: string
          name: string
          next_season_league_id?: string | null
          participant_ids?: string[]
          previous_season_league_id?: string | null
          promote_count?: number
          public_slug?: string | null
          public_view?: boolean
          relegate_count?: number
          result_mode?: string
          season_group_id?: string | null
          season_number?: number
          status?: string
          updated_at?: string
        }
        Update: {
          best_of_legs?: number
          club_id?: string
          created_at?: string
          created_by?: string
          division_level?: number
          division_name?: string | null
          format?: string
          game_mode?: string
          id?: string
          name?: string
          next_season_league_id?: string | null
          participant_ids?: string[]
          previous_season_league_id?: string | null
          promote_count?: number
          public_slug?: string | null
          public_view?: boolean
          relegate_count?: number
          result_mode?: string
          season_group_id?: string | null
          season_number?: number
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
          {
            foreignKeyName: "leagues_next_season_league_id_fkey"
            columns: ["next_season_league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leagues_next_season_league_id_fkey"
            columns: ["next_season_league_id"]
            isOneToOne: false
            referencedRelation: "leagues_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leagues_previous_season_league_id_fkey"
            columns: ["previous_season_league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leagues_previous_season_league_id_fkey"
            columns: ["previous_season_league_id"]
            isOneToOne: false
            referencedRelation: "leagues_public"
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
      match_reflections: {
        Row: {
          club_id: string
          created_at: string
          focus_rating: number | null
          game_id: string
          id: string
          improve_next: string | null
          user_id: string
          went_well: string | null
        }
        Insert: {
          club_id?: string
          created_at?: string
          focus_rating?: number | null
          game_id: string
          id?: string
          improve_next?: string | null
          user_id?: string
          went_well?: string | null
        }
        Update: {
          club_id?: string
          created_at?: string
          focus_rating?: number | null
          game_id?: string
          id?: string
          improve_next?: string | null
          user_id?: string
          went_well?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_reflections_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_reflections_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_reflections_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      online_duels: {
        Row: {
          challenger_average: number | null
          challenger_darts: number | null
          challenger_finished_at: string | null
          challenger_user_id: string
          club_id: string
          created_at: string
          custom_start_score: number | null
          decline_reason: string | null
          double_in: boolean
          double_out: boolean
          expires_at: string
          id: string
          mode: string
          opponent_average: number | null
          opponent_darts: number | null
          opponent_finished_at: string | null
          opponent_user_id: string
          status: string
          winner_user_id: string | null
        }
        Insert: {
          challenger_average?: number | null
          challenger_darts?: number | null
          challenger_finished_at?: string | null
          challenger_user_id: string
          club_id: string
          created_at?: string
          custom_start_score?: number | null
          decline_reason?: string | null
          double_in?: boolean
          double_out?: boolean
          expires_at?: string
          id?: string
          mode: string
          opponent_average?: number | null
          opponent_darts?: number | null
          opponent_finished_at?: string | null
          opponent_user_id: string
          status?: string
          winner_user_id?: string | null
        }
        Update: {
          challenger_average?: number | null
          challenger_darts?: number | null
          challenger_finished_at?: string | null
          challenger_user_id?: string
          club_id?: string
          created_at?: string
          custom_start_score?: number | null
          decline_reason?: string | null
          double_in?: boolean
          double_out?: boolean
          expires_at?: string
          id?: string
          mode?: string
          opponent_average?: number | null
          opponent_darts?: number | null
          opponent_finished_at?: string | null
          opponent_user_id?: string
          status?: string
          winner_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "online_duels_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_duels_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
        ]
      }
      online_match_players: {
        Row: {
          decline_reason: string | null
          match_id: string
          responded_at: string | null
          slot: number
          status: string
          user_id: string
        }
        Insert: {
          decline_reason?: string | null
          match_id: string
          responded_at?: string | null
          slot: number
          status?: string
          user_id: string
        }
        Update: {
          decline_reason?: string | null
          match_id?: string
          responded_at?: string | null
          slot?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_match_players_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "online_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      online_matches: {
        Row: {
          best_of_legs: number
          best_of_sets: number | null
          club_id: string
          created_at: string
          created_by: string
          custom_start_score: number | null
          decline_reason: string | null
          double_in: boolean
          double_out: boolean
          game_state: Json | null
          id: string
          is_doubles: boolean
          mode: string
          player1_user_id: string
          player2_user_id: string
          source_id: string | null
          source_type: string
          starter: string
          status: string
          team_names: Json | null
          updated_at: string
        }
        Insert: {
          best_of_legs?: number
          best_of_sets?: number | null
          club_id: string
          created_at?: string
          created_by: string
          custom_start_score?: number | null
          decline_reason?: string | null
          double_in?: boolean
          double_out?: boolean
          game_state?: Json | null
          id?: string
          is_doubles?: boolean
          mode: string
          player1_user_id: string
          player2_user_id: string
          source_id?: string | null
          source_type?: string
          starter?: string
          status?: string
          team_names?: Json | null
          updated_at?: string
        }
        Update: {
          best_of_legs?: number
          best_of_sets?: number | null
          club_id?: string
          created_at?: string
          created_by?: string
          custom_start_score?: number | null
          decline_reason?: string | null
          double_in?: boolean
          double_out?: boolean
          game_state?: Json | null
          id?: string
          is_doubles?: boolean
          mode?: string
          player1_user_id?: string
          player2_user_id?: string
          source_id?: string | null
          source_type?: string
          starter?: string
          status?: string
          team_names?: Json | null
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
      online_open_challenges: {
        Row: {
          best_of_legs: number
          club_id: string
          created_at: string
          created_by: string
          custom_start_score: number | null
          double_in: boolean
          double_out: boolean
          id: string
          match_id: string | null
          mode: string
          status: string
          taken_by: string | null
        }
        Insert: {
          best_of_legs?: number
          club_id: string
          created_at?: string
          created_by: string
          custom_start_score?: number | null
          double_in?: boolean
          double_out?: boolean
          id?: string
          match_id?: string | null
          mode: string
          status?: string
          taken_by?: string | null
        }
        Update: {
          best_of_legs?: number
          club_id?: string
          created_at?: string
          created_by?: string
          custom_start_score?: number | null
          double_in?: boolean
          double_out?: boolean
          id?: string
          match_id?: string | null
          mode?: string
          status?: string
          taken_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "online_open_challenges_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_open_challenges_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_open_challenges_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "online_matches"
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
          club_id: string
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
          pin_hash: string | null
          pin_salt: string | null
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
          club_id: string
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
          pin_hash?: string | null
          pin_salt?: string | null
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
          club_id?: string
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
          pin_hash?: string | null
          pin_salt?: string | null
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
          best_of_sets: number | null
          boards: number
          bracket: Json
          champion: string | null
          club_id: string
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
          best_of_sets?: number | null
          boards?: number
          bracket?: Json
          champion?: string | null
          club_id: string
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
          best_of_sets?: number | null
          boards?: number
          bracket?: Json
          champion?: string | null
          club_id?: string
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
          ai_notes: string | null
          ai_segments: Json | null
          before_path: string
          board: string
          calib_taps: Json | null
          calibration_meta: Json | null
          camera_zoom: number | null
          created_at: string
          id: string
          image_size: number
          labels: Json
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          user_id: string
        }
        Insert: {
          after_path: string
          ai_notes?: string | null
          ai_segments?: Json | null
          before_path: string
          board?: string
          calib_taps?: Json | null
          calibration_meta?: Json | null
          camera_zoom?: number | null
          created_at?: string
          id?: string
          image_size?: number
          labels?: Json
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          user_id: string
        }
        Update: {
          after_path?: string
          ai_notes?: string | null
          ai_segments?: Json | null
          before_path?: string
          board?: string
          calib_taps?: Json | null
          calibration_meta?: Json | null
          camera_zoom?: number | null
          created_at?: string
          id?: string
          image_size?: number
          labels?: Json
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
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
      league_fixtures_public: {
        Row: {
          id: string | null
          league_id: string | null
          leg: string | null
          player1_legs_won: number | null
          player1_name: string | null
          player2_legs_won: number | null
          player2_name: string | null
          round_number: number | null
          scheduled_date: string | null
          status: string | null
          winner_slot: number | null
        }
        Relationships: [
          {
            foreignKeyName: "league_fixtures_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_fixtures_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues_public"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues_public: {
        Row: {
          best_of_legs: number | null
          format: string | null
          game_mode: string | null
          id: string | null
          name: string | null
          participant_ids: string[] | null
          public_slug: string | null
          public_view: boolean | null
          result_mode: string | null
          status: string | null
        }
        Insert: {
          best_of_legs?: number | null
          format?: string | null
          game_mode?: string | null
          id?: string | null
          name?: string | null
          participant_ids?: string[] | null
          public_slug?: string | null
          public_view?: boolean | null
          result_mode?: string | null
          status?: string | null
        }
        Update: {
          best_of_legs?: number | null
          format?: string | null
          game_mode?: string | null
          id?: string | null
          name?: string | null
          participant_ids?: string[] | null
          public_slug?: string | null
          public_view?: boolean | null
          result_mode?: string | null
          status?: string | null
        }
        Relationships: []
      }
      tournaments_public: {
        Row: {
          attendance: Json | null
          best_of_legs: number | null
          best_of_sets: number | null
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
          best_of_sets?: number | null
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
          best_of_sets?: number | null
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
      _autodarts_cached_token: {
        Args: { p_board_id: string; p_club_id: string }
        Returns: string
      }
      _autodarts_get_access_token: {
        Args: { p_board_id: string; p_club_id: string }
        Returns: string
      }
      _autodarts_http_post_polled: {
        Args: {
          p_body: Json
          p_headers: Json
          p_poll_attempts?: number
          p_retry_count?: number
          p_timeout_ms?: number
          p_url: string
        }
        Returns: {
          content: Json
          status_code: number
        }[]
      }
      _jwt_claim: {
        Args: { p_claim: string; p_token: string }
        Returns: string
      }
      abort_idle_online_match: { Args: { _match_id: string }; Returns: boolean }
      accept_club_invite: { Args: { _token: string }; Returns: string }
      submit_online_bulloff: {
        Args: { _distance_mm: number; _match_id: string }
        Returns: Json
      }
      is_platform_owner: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      track_usage: {
        Args: { _feature: string }
        Returns: undefined
      }
      usage_overview: {
        Args: { _club?: string; _days?: number }
        Returns: Json
      }
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
          best_of_sets: number | null
          boards: number
          bracket: Json
          champion: string | null
          club_id: string
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
      admin_reset_player_pin: {
        Args: { p_player_id: string }
        Returns: undefined
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
      autodarts_check_connect_status: {
        Args: { p_board_number: number }
        Returns: Json
      }
      autodarts_check_start_match_status: {
        Args: { p_board_number: number }
        Returns: Json
      }
      autodarts_connect_board: {
        Args: {
          p_board_number: number
          p_cloud_email: string
          p_cloud_password: string
          p_connection_mode: string
          p_label: string
          p_local_api_key: string
          p_local_board_id: string
          p_local_ip: string
        }
        Returns: Json
      }
      autodarts_finish_match: {
        Args: { p_board_number: number; p_match_id: string }
        Returns: undefined
      }
      autodarts_poll_match: {
        Args: { p_board_number: number; p_match_id: string }
        Returns: Json
      }
      autodarts_refresh_board: {
        Args: { p_board_number: number }
        Returns: Json
      }
      autodarts_start_match: {
        Args: {
          p_base_score: number
          p_board_number: number
          p_double_out: boolean
          p_legs: number
        }
        Returns: Json
      }
      cancel_online_doubles: { Args: { _match_id: string }; Returns: undefined }
      cancel_online_duel: { Args: { _id: string }; Returns: undefined }
      cancel_open_challenge: { Args: { _id: string }; Returns: undefined }
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
      create_online_doubles_match: {
        Args: {
          _best_of_legs: number
          _custom_start_score: number
          _double_in: boolean
          _double_out: boolean
          _mode: string
          _opponent1: string
          _opponent2: string
          _partner: string
          _starter: string
          _team_names?: Json
        }
        Returns: string
      }
      create_online_duel: {
        Args: {
          _custom_start_score: number
          _double_in: boolean
          _double_out: boolean
          _mode: string
          _opponent: string
        }
        Returns: string
      }
      create_open_challenge: {
        Args: {
          _best_of_legs: number
          _custom_start_score: number
          _double_in: boolean
          _double_out: boolean
          _mode: string
        }
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
      is_online_match_member: { Args: { _match_id: string }; Returns: boolean }
      merge_players: {
        Args: { p_keep: string; p_remove: string }
        Returns: Json
      }
      my_online_duels: {
        Args: never
        Returns: {
          challenger_user_id: string
          created_at: string
          custom_start_score: number
          decline_reason: string
          double_in: boolean
          double_out: boolean
          expired: boolean
          expires_at: string
          id: string
          mode: string
          my_average: number
          my_darts: number
          my_finished: boolean
          opponent_user_id: string
          status: string
          their_average: number
          their_darts: number
          their_finished: boolean
          winner_user_id: string
        }[]
      }
      online_leaderboard: {
        Args: never
        Returns: {
          emoji: string
          name: string
          played: number
          player_id: string
          win_rate: number
          wins: number
        }[]
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
      rename_in_json: {
        Args: { p_doc: Json; p_new: string; p_old: string }
        Returns: Json
      }
      rename_in_team_name: {
        Args: { p_new: string; p_old: string; p_text: string }
        Returns: string
      }
      rename_player_everywhere: {
        Args: { p_club: string; p_new: string; p_old: string }
        Returns: undefined
      }
      request_to_join_club: { Args: { _club_id: string }; Returns: string }
      respond_online_doubles: {
        Args: {
          _accept: boolean
          _initial_game_state?: Json
          _match_id: string
          _reason?: string
        }
        Returns: string
      }
      respond_online_duel: {
        Args: { _accept: boolean; _id: string; _reason?: string }
        Returns: string
      }
      respond_to_join_request: {
        Args: { _approve: boolean; _request_id: string }
        Returns: undefined
      }
      set_player_pin: {
        Args: { p_pin_hash: string; p_pin_salt: string; p_player_id: string }
        Returns: undefined
      }
      submit_online_duel_result: {
        Args: { _average: number; _darts: number; _id: string }
        Returns: string
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
      take_open_challenge: { Args: { _id: string }; Returns: string }
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
