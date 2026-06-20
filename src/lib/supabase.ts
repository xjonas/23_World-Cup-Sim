import { createClient, type User } from '@supabase/supabase-js';

export interface PredictorDatabase {
  public: {
    Tables: {
      fixtures: {
        Row: {
          id: string;
          phase: string;
          kickoff_utc: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          phase: string;
          kickoff_utc: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          phase?: string;
          kickoff_utc?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          user_id: string;
          display_name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          display_name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          display_name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      match_predictions: {
        Row: {
          user_id: string;
          match_id: string;
          home_goals: number;
          away_goals: number;
          source: 'manual' | 'simulation';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          match_id: string;
          home_goals: number;
          away_goals: number;
          source?: 'manual' | 'simulation';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          match_id?: string;
          home_goals?: number;
          away_goals?: number;
          source?: 'manual' | 'simulation';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase =
  supabaseUrl && supabaseKey ? createClient<PredictorDatabase>(supabaseUrl, supabaseKey) : null;

export type SupabaseUser = User;
