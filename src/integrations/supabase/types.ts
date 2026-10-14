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
      account_groups: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      custom_props: {
        Row: {
          aspect_ratio: number
          created_at: string
          created_by: string | null
          default_w: number
          frames: Json
          id: string
          label: string
          workspace_id: string
        }
        Insert: {
          aspect_ratio?: number
          created_at?: string
          created_by?: string | null
          default_w?: number
          frames: Json
          id: string
          label: string
          workspace_id: string
        }
        Update: {
          aspect_ratio?: number
          created_at?: string
          created_by?: string | null
          default_w?: number
          frames?: Json
          id?: string
          label?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_props_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_notes: {
        Row: {
          body: string
          created_at: string
          id: string
          read_at: string | null
          recipient_id: string
          sender_id: string
          workspace_id: string
          x: number
          y: number
          zone_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_id: string
          sender_id: string
          workspace_id: string
          x?: number
          y?: number
          zone_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_id?: string
          sender_id?: string
          workspace_id?: string
          x?: number
          y?: number
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "desk_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      map_overrides: {
        Row: {
          data: Json
          updated_at: string
          updated_by: string | null
          version: number
          workspace_id: string
        }
        Insert: {
          data: Json
          updated_at?: string
          updated_by?: string | null
          version?: number
          workspace_id: string
        }
        Update: {
          data?: Json
          updated_at?: string
          updated_by?: string | null
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "map_overrides_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      map_save_points: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "map_save_points_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_egress: {
        Row: {
          created_at: string
          duration_seconds: number | null
          egress_id: string | null
          ended_at: string | null
          error: string | null
          file_path: string | null
          file_size: number | null
          id: string
          meeting_id: string
          room_name: string
          started_at: string | null
          started_by: string
          status: string
          stopped_by: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          egress_id?: string | null
          ended_at?: string | null
          error?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          meeting_id: string
          room_name: string
          started_at?: string | null
          started_by: string
          status?: string
          stopped_by?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          egress_id?: string | null
          ended_at?: string | null
          error?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          meeting_id?: string
          room_name?: string
          started_at?: string | null
          started_by?: string
          status?: string
          stopped_by?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_egress_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_favorites: {
        Row: {
          created_at: string
          id: string
          meeting_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          meeting_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          meeting_id?: string
          user_id?: string
        }
        Relationships: []
      }
      meeting_folder_items: {
        Row: {
          created_at: string
          folder_id: string
          id: string
          meeting_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          folder_id: string
          id?: string
          meeting_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          folder_id?: string
          id?: string
          meeting_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_folder_items_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "meeting_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meeting_notes: {
        Row: {
          body: string
          created_at: string
          id: string
          meeting_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          meeting_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          meeting_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meeting_participants: {
        Row: {
          id: string
          joined_at: string
          left_at: string | null
          meeting_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          left_at?: string | null
          meeting_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          left_at?: string | null
          meeting_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_participants_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_recording_shares: {
        Row: {
          created_at: string
          meeting_id: string
          recipient_id: string
          sender_id: string
          share_batch_id: string | null
        }
        Insert: {
          created_at?: string
          meeting_id: string
          recipient_id: string
          sender_id: string
          share_batch_id?: string | null
        }
        Update: {
          created_at?: string
          meeting_id?: string
          recipient_id?: string
          sender_id?: string
          share_batch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_recording_shares_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          ai_error: string | null
          ai_generated_at: string | null
          ai_status: string
          ended_at: string | null
          host_id: string | null
          id: string
          recorded_by: string | null
          recording_duration_seconds: number | null
          recording_path: string | null
          recording_started_at: string | null
          recording_uploaded_at: string | null
          started_at: string
          summary: string | null
          title: string | null
          transcript: string | null
          workspace_id: string
          zone_id: string
          zone_label: string
        }
        Insert: {
          ai_error?: string | null
          ai_generated_at?: string | null
          ai_status?: string
          ended_at?: string | null
          host_id?: string | null
          id?: string
          recorded_by?: string | null
          recording_duration_seconds?: number | null
          recording_path?: string | null
          recording_started_at?: string | null
          recording_uploaded_at?: string | null
          started_at?: string
          summary?: string | null
          title?: string | null
          transcript?: string | null
          workspace_id: string
          zone_id: string
          zone_label: string
        }
        Update: {
          ai_error?: string | null
          ai_generated_at?: string | null
          ai_status?: string
          ended_at?: string | null
          host_id?: string | null
          id?: string
          recorded_by?: string | null
          recording_duration_seconds?: number | null
          recording_path?: string | null
          recording_started_at?: string | null
          recording_uploaded_at?: string | null
          started_at?: string
          summary?: string | null
          title?: string | null
          transcript?: string | null
          workspace_id?: string
          zone_id?: string
          zone_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          channel_id: string
          channel_type: string
          created_at: string
          id: string
          sender_id: string
          workspace_id: string
        }
        Insert: {
          body: string
          channel_id: string
          channel_type: string
          created_at?: string
          id?: string
          sender_id: string
          workspace_id: string
        }
        Update: {
          body?: string
          channel_id?: string
          channel_type?: string
          created_at?: string
          id?: string
          sender_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      office_sessions: {
        Row: {
          active: boolean
          claimed_at: string
          generation: number
          session_id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          claimed_at?: string
          generation?: number
          session_id: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          claimed_at?: string
          generation?: number
          session_id?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "office_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          facing: string
          is_online: boolean
          updated_at: string
          user_id: string
          workspace_id: string
          x: number
          y: number
          zone: string
        }
        Insert: {
          facing?: string
          is_online?: boolean
          updated_at?: string
          user_id: string
          workspace_id: string
          x?: number
          y?: number
          zone?: string
        }
        Update: {
          facing?: string
          is_online?: boolean
          updated_at?: string
          user_id?: string
          workspace_id?: string
          x?: number
          y?: number
          zone?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_color: string
          birth_date: string | null
          city: string | null
          country_code: string | null
          created_at: string
          display_name: string
          first_name: string | null
          group_id: string | null
          id: string
          last_name: string | null
          onboarded_at: string | null
          plan: Database["public"]["Enums"]["account_plan"]
          sprite_id: string
          state: string | null
          status: string
          tagline: string | null
          updated_at: string
        }
        Insert: {
          avatar_color?: string
          birth_date?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          display_name: string
          first_name?: string | null
          group_id?: string | null
          id: string
          last_name?: string | null
          onboarded_at?: string | null
          plan?: Database["public"]["Enums"]["account_plan"]
          sprite_id?: string
          state?: string | null
          status?: string
          tagline?: string | null
          updated_at?: string
        }
        Update: {
          avatar_color?: string
          birth_date?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          display_name?: string
          first_name?: string | null
          group_id?: string | null
          id?: string
          last_name?: string | null
          onboarded_at?: string | null
          plan?: Database["public"]["Enums"]["account_plan"]
          sprite_id?: string
          state?: string | null
          status?: string
          tagline?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "account_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      prop_states: {
        Row: {
          frame: number
          prop_id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          frame?: number
          prop_id: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          frame?: number
          prop_id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prop_states_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      rtc_events: {
        Row: {
          connection_state: string | null
          context: string | null
          created_at: string
          details: Json
          disconnect_reason: string | null
          event_type: string
          generation: number | null
          id: number
          map_version: number | null
          room_name: string | null
          session_id: string | null
          user_id: string
          workspace_id: string | null
          zone_id: string | null
        }
        Insert: {
          connection_state?: string | null
          context?: string | null
          created_at?: string
          details?: Json
          disconnect_reason?: string | null
          event_type: string
          generation?: number | null
          id?: never
          map_version?: number | null
          room_name?: string | null
          session_id?: string | null
          user_id?: string
          workspace_id?: string | null
          zone_id?: string | null
        }
        Update: {
          connection_state?: string | null
          context?: string | null
          created_at?: string
          details?: Json
          disconnect_reason?: string | null
          event_type?: string
          generation?: number | null
          id?: never
          map_version?: number | null
          room_name?: string | null
          session_id?: string | null
          user_id?: string
          workspace_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rtc_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_notes: {
        Row: {
          body: string
          id: string
          original_created_at: string
          saved_at: string
          sender_id: string
          sender_name: string | null
          user_id: string
        }
        Insert: {
          body: string
          id?: string
          original_created_at: string
          saved_at?: string
          sender_id: string
          sender_name?: string | null
          user_id: string
        }
        Update: {
          body?: string
          id?: string
          original_created_at?: string
          saved_at?: string
          sender_id?: string
          sender_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sprite_skins: {
        Row: {
          created_at: string
          created_by: string | null
          dims: Json
          gender: string
          id: string
          label: string
          mirror_left_from_right: boolean
          mirror_right_from_left: boolean
          sheets: Json
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dims: Json
          gender?: string
          id: string
          label: string
          mirror_left_from_right?: boolean
          mirror_right_from_left?: boolean
          sheets: Json
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dims?: Json
          gender?: string
          id?: string
          label?: string
          mirror_left_from_right?: boolean
          mirror_right_from_left?: boolean
          sheets?: Json
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sprite_skins_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      workspace_claims: {
        Row: {
          claimed_at: string
          user_id: string
          workspace_id: string
          zone_id: string
        }
        Insert: {
          claimed_at?: string
          user_id: string
          workspace_id: string
          zone_id: string
        }
        Update: {
          claimed_at?: string
          user_id?: string
          workspace_id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_claims_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string | null
          expires_at: string
          id: string
          invited_by: string
          max_uses: number
          role: Database["public"]["Enums"]["workspace_role"]
          token: string
          uses: number
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by: string
          max_uses?: number
          role?: Database["public"]["Enums"]["workspace_role"]
          token?: string
          uses?: number
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string
          max_uses?: number
          role?: Database["public"]["Enums"]["workspace_role"]
          token?: string
          uses?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          joined_at: string
          member_profile: string
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          joined_at?: string
          member_profile?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          joined_at?: string
          member_profile?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          cover_url: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          owner_id: string
          slug: string
          tier: number
          updated_at: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_id: string
          slug: string
          tier?: number
          updated_at?: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          slug?: string
          tier?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      account_plan_allows_tier: {
        Args: {
          _plan: Database["public"]["Enums"]["account_plan"]
          _tier: number
        }
        Returns: boolean
      }
      account_plan_max_tier: {
        Args: { _plan: Database["public"]["Enums"]["account_plan"] }
        Returns: number
      }
      can_read_meeting_participants: {
        Args: { _meeting_id: string; _user_id: string }
        Returns: boolean
      }
      can_record_meeting: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      claim_office_session: {
        Args: { _session_id: string; _workspace_id: string }
        Returns: {
          generation: number
          session_id: string
        }[]
      }
      current_user_email: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invite_peek: { Args: { _token: string }; Returns: Json }
      is_meeting_participant: {
        Args: { _meeting_id: string; _user_id: string }
        Returns: boolean
      }
      is_workspace_admin: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      meeting_access_status: {
        Args: { _meeting_id: string }
        Returns: {
          kind: string
          user_id: string
        }[]
      }
      meeting_join: {
        Args: { _workspace_id: string; _zone_id: string; _zone_label: string }
        Returns: string
      }
      meeting_leave: { Args: { _meeting_id: string }; Returns: undefined }
      meeting_mark_ai_processing: {
        Args: { _meeting_id: string }
        Returns: undefined
      }
      meeting_mark_recording_started: {
        Args: { _meeting_id: string }
        Returns: undefined
      }
      meeting_set_ai_error: {
        Args: { _error: string; _meeting_id: string }
        Returns: undefined
      }
      meeting_set_ai_result: {
        Args: { _meeting_id: string; _summary: string; _transcript: string }
        Returns: undefined
      }
      meeting_set_recording: {
        Args: { _duration_seconds: number; _meeting_id: string; _path: string }
        Returns: undefined
      }
      meeting_set_title: {
        Args: { _meeting_id: string; _title: string }
        Returns: undefined
      }
      meeting_share_recording: {
        Args: { _meeting_id: string; _recipient_id: string }
        Returns: undefined
      }
      meeting_share_recording_batch: {
        Args: { _meeting_id: string; _recipient_ids: string[] }
        Returns: Json
      }
      meeting_undo_share_batch: {
        Args: { _batch_id: string; _meeting_id: string }
        Returns: number
      }
      release_office_session: {
        Args: { _generation: number; _session_id: string }
        Returns: boolean
      }
      rtc_can_access_topic: { Args: { _topic: string }; Returns: boolean }
      workspace_accept_invite: { Args: { _token: string }; Returns: string }
    }
    Enums: {
      account_plan: "essencial" | "pro" | "premium"
      app_role: "admin" | "supervisor" | "member" | "master"
      workspace_role: "owner" | "admin" | "member"
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
      account_plan: ["essencial", "pro", "premium"],
      app_role: ["admin", "supervisor", "member", "master"],
      workspace_role: ["owner", "admin", "member"],
    },
  },
} as const
