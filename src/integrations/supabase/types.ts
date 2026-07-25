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
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          diff: Json
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          org_id: string | null
          session_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          diff?: Json
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          org_id?: string | null
          session_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          diff?: Json
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          org_id?: string | null
          session_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          metadata: Json
          org_id: string
          paid_at: string | null
          provider: string
          provider_payment_id: string | null
          status: string
          subscription_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          org_id: string
          paid_at?: string | null
          provider?: string
          provider_payment_id?: string | null
          status: string
          subscription_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          org_id?: string
          paid_at?: string | null
          provider?: string
          provider_payment_id?: string | null
          status?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "org_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plans: {
        Row: {
          active: boolean
          code: string
          created_at: string
          currency: string
          description: string | null
          features: Json
          id: string
          interval: string
          name: string
          price_cents: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          interval?: string
          name: string
          price_cents?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          interval?: string
          name?: string
          price_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      document_processing_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          document_id: string
          error: string | null
          id: string
          org_id: string
          payload: Json
          progress: number
          scheduled_at: string
          stage: string
          started_at: string | null
          status: Database["public"]["Enums"]["doc_processing_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          document_id: string
          error?: string | null
          id?: string
          org_id: string
          payload?: Json
          progress?: number
          scheduled_at?: string
          stage: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["doc_processing_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          document_id?: string
          error?: string | null
          id?: string
          org_id?: string
          payload?: Json
          progress?: number
          scheduled_at?: string
          stage?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["doc_processing_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_processing_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "matter_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_processing_jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_versions: {
        Row: {
          checksum: string | null
          created_at: string
          document_id: string
          id: string
          mime_type: string | null
          notes: string | null
          org_id: string
          size_bytes: number | null
          storage_path: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          checksum?: string | null
          created_at?: string
          document_id: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          org_id: string
          size_bytes?: number | null
          storage_path: string
          uploaded_by?: string | null
          version: number
        }
        Update: {
          checksum?: string | null
          created_at?: string
          document_id?: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          org_id?: string
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "matter_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      intelligence_runs: {
        Row: {
          completed_at: string | null
          cost_cents: number | null
          created_at: string
          engine: Database["public"]["Enums"]["intelligence_engine"]
          error: string | null
          id: string
          input: Json
          matter_id: string | null
          model: string | null
          org_id: string
          output: Json
          requested_by: string | null
          started_at: string | null
          status: string
          tokens_used: number | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          cost_cents?: number | null
          created_at?: string
          engine: Database["public"]["Enums"]["intelligence_engine"]
          error?: string | null
          id?: string
          input?: Json
          matter_id?: string | null
          model?: string | null
          org_id: string
          output?: Json
          requested_by?: string | null
          started_at?: string | null
          status?: string
          tokens_used?: number | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          cost_cents?: number | null
          created_at?: string
          engine?: Database["public"]["Enums"]["intelligence_engine"]
          error?: string | null
          id?: string
          input?: Json
          matter_id?: string | null
          model?: string | null
          org_id?: string
          output?: Json
          requested_by?: string | null
          started_at?: string | null
          status?: string
          tokens_used?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intelligence_runs_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intelligence_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_relationships: {
        Row: {
          created_at: string
          data: Json
          id: string
          matter_id: string
          object_id: string
          org_id: string
          relation: string
          source_run_id: string | null
          subject_id: string
          updated_at: string
          weight: number | null
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          matter_id: string
          object_id: string
          org_id: string
          relation: string
          source_run_id?: string | null
          subject_id: string
          updated_at?: string
          weight?: number | null
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          matter_id?: string
          object_id?: string
          org_id?: string
          relation?: string
          source_run_id?: string | null
          subject_id?: string
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_relationships_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_relationships_object_id_fkey"
            columns: ["object_id"]
            isOneToOne: false
            referencedRelation: "matter_knowledge"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_relationships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_relationships_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "intelligence_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_relationships_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "matter_knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_authorities: {
        Row: {
          body: string | null
          citation: string | null
          created_at: string
          effective_at: string | null
          id: string
          issuer: string | null
          jurisdiction: string | null
          kind: string
          metadata: Json
          published_at: string | null
          short_title: string | null
          source_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          citation?: string | null
          created_at?: string
          effective_at?: string | null
          id?: string
          issuer?: string | null
          jurisdiction?: string | null
          kind: string
          metadata?: Json
          published_at?: string | null
          short_title?: string | null
          source_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          citation?: string | null
          created_at?: string
          effective_at?: string | null
          id?: string
          issuer?: string | null
          jurisdiction?: string | null
          kind?: string
          metadata?: Json
          published_at?: string | null
          short_title?: string | null
          source_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      legal_citations: {
        Row: {
          authority_id: string
          citation_text: string
          cited_authority_id: string | null
          context: string | null
          created_at: string
          id: string
        }
        Insert: {
          authority_id: string
          citation_text: string
          cited_authority_id?: string | null
          context?: string | null
          created_at?: string
          id?: string
        }
        Update: {
          authority_id?: string
          citation_text?: string
          cited_authority_id?: string | null
          context?: string | null
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_citations_authority_id_fkey"
            columns: ["authority_id"]
            isOneToOne: false
            referencedRelation: "legal_authorities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_citations_cited_authority_id_fkey"
            columns: ["cited_authority_id"]
            isOneToOne: false
            referencedRelation: "legal_authorities"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_source_connectors: {
        Row: {
          base_url: string | null
          code: string
          config: Json
          created_at: string
          description: string | null
          id: string
          last_sync_at: string | null
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          base_url?: string | null
          code: string
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          last_sync_at?: string | null
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          base_url?: string | null
          code?: string
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          last_sync_at?: string | null
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      matter_documents: {
        Row: {
          checksum: string | null
          classification: Json
          created_at: string
          current_version: number
          deleted_at: string | null
          doc_type: string | null
          id: string
          language: string | null
          matter_id: string
          media_kind: string | null
          metadata: Json
          mime_type: string | null
          org_id: string
          page_count: number | null
          processing_error: string | null
          processing_status: Database["public"]["Enums"]["doc_processing_status"]
          size_bytes: number | null
          storage_path: string | null
          text_content: string | null
          title: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          checksum?: string | null
          classification?: Json
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          doc_type?: string | null
          id?: string
          language?: string | null
          matter_id: string
          media_kind?: string | null
          metadata?: Json
          mime_type?: string | null
          org_id: string
          page_count?: number | null
          processing_error?: string | null
          processing_status?: Database["public"]["Enums"]["doc_processing_status"]
          size_bytes?: number | null
          storage_path?: string | null
          text_content?: string | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          checksum?: string | null
          classification?: Json
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          doc_type?: string | null
          id?: string
          language?: string | null
          matter_id?: string
          media_kind?: string | null
          metadata?: Json
          mime_type?: string | null
          org_id?: string
          page_count?: number | null
          processing_error?: string | null
          processing_status?: Database["public"]["Enums"]["doc_processing_status"]
          size_bytes?: number | null
          storage_path?: string | null
          text_content?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matter_documents_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_events: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          event_type: string
          id: string
          location: string | null
          matter_id: string
          notes: string | null
          org_id: string
          scheduled_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          event_type: string
          id?: string
          location?: string | null
          matter_id: string
          notes?: string | null
          org_id: string
          scheduled_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          event_type?: string
          id?: string
          location?: string | null
          matter_id?: string
          notes?: string | null
          org_id?: string
          scheduled_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_events_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_knowledge: {
        Row: {
          body: string | null
          confidence: number | null
          created_at: string
          data: Json
          engine: Database["public"]["Enums"]["intelligence_engine"]
          id: string
          kind: string
          language: string
          matter_id: string
          org_id: string
          source_document_id: string | null
          source_run_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          confidence?: number | null
          created_at?: string
          data?: Json
          engine: Database["public"]["Enums"]["intelligence_engine"]
          id?: string
          kind: string
          language?: string
          matter_id: string
          org_id: string
          source_document_id?: string | null
          source_run_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          confidence?: number | null
          created_at?: string
          data?: Json
          engine?: Database["public"]["Enums"]["intelligence_engine"]
          id?: string
          kind?: string
          language?: string
          matter_id?: string
          org_id?: string
          source_document_id?: string | null
          source_run_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_knowledge_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_knowledge_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_knowledge_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "matter_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_knowledge_source_run_id_fkey"
            columns: ["source_run_id"]
            isOneToOne: false
            referencedRelation: "intelligence_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          matter_id: string
          org_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          matter_id: string
          org_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          matter_id?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_notes_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_parties: {
        Row: {
          contact: Json
          created_at: string
          deleted_at: string | null
          id: string
          matter_id: string
          name: string
          org_id: string
          party_type: string
          role_description: string | null
          updated_at: string
        }
        Insert: {
          contact?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          matter_id: string
          name: string
          org_id: string
          party_type: string
          role_description?: string | null
          updated_at?: string
        }
        Update: {
          contact?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          matter_id?: string
          name?: string
          org_id?: string
          party_type?: string
          role_description?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_parties_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_parties_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_tasks: {
        Row: {
          assignee_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          due_date: string | null
          id: string
          matter_id: string
          org_id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          matter_id: string
          org_id: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          matter_id?: string
          org_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_tasks_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matters: {
        Row: {
          client_name: string | null
          closed_at: string | null
          court: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          docket_number: string | null
          id: string
          jurisdiction: string | null
          lead_lawyer_id: string | null
          matter_type: Database["public"]["Enums"]["matter_type"]
          opened_at: string
          org_id: string
          practice_area: string | null
          priority: Database["public"]["Enums"]["matter_priority"]
          reference_code: string | null
          status: Database["public"]["Enums"]["matter_status"]
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          client_name?: string | null
          closed_at?: string | null
          court?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          docket_number?: string | null
          id?: string
          jurisdiction?: string | null
          lead_lawyer_id?: string | null
          matter_type?: Database["public"]["Enums"]["matter_type"]
          opened_at?: string
          org_id: string
          practice_area?: string | null
          priority?: Database["public"]["Enums"]["matter_priority"]
          reference_code?: string | null
          status?: Database["public"]["Enums"]["matter_status"]
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          client_name?: string | null
          closed_at?: string | null
          court?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          docket_number?: string | null
          id?: string
          jurisdiction?: string | null
          lead_lawyer_id?: string | null
          matter_type?: Database["public"]["Enums"]["matter_type"]
          opened_at?: string
          org_id?: string
          practice_area?: string | null
          priority?: Database["public"]["Enums"]["matter_priority"]
          reference_code?: string | null
          status?: Database["public"]["Enums"]["matter_status"]
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matters_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_memberships: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          invited_by: string | null
          org_id: string
          role_in_org: Database["public"]["Enums"]["org_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          invited_by?: string | null
          org_id: string
          role_in_org?: Database["public"]["Enums"]["org_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          invited_by?: string | null
          org_id?: string
          role_in_org?: Database["public"]["Enums"]["org_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_role_permissions: {
        Row: {
          created_at: string
          granted: boolean
          id: string
          org_id: string
          permission_code: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Insert: {
          created_at?: string
          granted?: boolean
          id?: string
          org_id: string
          permission_code: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Update: {
          created_at?: string
          granted?: boolean
          id?: string
          org_id?: string
          permission_code?: string
          role?: Database["public"]["Enums"]["org_role"]
        }
        Relationships: [
          {
            foreignKeyName: "org_role_permissions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
        ]
      }
      org_subscriptions: {
        Row: {
          cancel_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          metadata: Json
          org_id: string
          plan_id: string
          provider: string
          provider_subscription_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cancel_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          org_id: string
          plan_id: string
          provider?: string
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          cancel_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          org_id?: string
          plan_id?: string
          provider?: string
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          edition: string
          id: string
          name: string
          plan: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          edition?: string
          id?: string
          name: string
          plan?: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          edition?: string
          id?: string
          name?: string
          plan?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          action: string
          code: string
          created_at: string
          description: string | null
          id: string
          resource: string
        }
        Insert: {
          action: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          resource: string
        }
        Update: {
          action?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          resource?: string
        }
        Relationships: []
      }
      plan_entitlements: {
        Row: {
          id: string
          permission_code: string
          plan_id: string
          quota: number | null
        }
        Insert: {
          id?: string
          permission_code: string
          plan_id: string
          quota?: number | null
        }
        Update: {
          id?: string
          permission_code?: string
          plan_id?: string
          quota?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_entitlements_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "plan_entitlements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          default_org_id: string | null
          deleted_at: string | null
          display_name: string | null
          full_name: string | null
          id: string
          locale: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          default_org_id?: string | null
          deleted_at?: string | null
          display_name?: string | null
          full_name?: string | null
          id: string
          locale?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          default_org_id?: string | null
          deleted_at?: string | null
          display_name?: string | null
          full_name?: string | null
          id?: string
          locale?: string
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_code: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Insert: {
          created_at?: string
          id?: string
          permission_code: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Update: {
          created_at?: string
          id?: string
          permission_code?: string
          role?: Database["public"]["Enums"]["org_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
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
      can_contribute_org: {
        Args: { _org: string; _user: string }
        Returns: boolean
      }
      can_manage_org: {
        Args: { _org: string; _user: string }
        Returns: boolean
      }
      has_permission: {
        Args: { _org: string; _perm: string; _user: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: { Args: { _org: string; _user: string }; Returns: boolean }
      org_role_of: {
        Args: { _org: string; _user: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "moderator"
        | "user"
        | "super_admin"
        | "platform_admin"
      doc_processing_status:
        | "pending"
        | "uploading"
        | "uploaded"
        | "extracting"
        | "extracted"
        | "classifying"
        | "classified"
        | "analyzing"
        | "analyzed"
        | "failed"
      intelligence_engine:
        | "legal"
        | "case"
        | "evidence"
        | "witness"
        | "timeline"
        | "litigation"
        | "contract"
        | "research"
        | "work_product"
      matter_priority: "low" | "normal" | "high" | "urgent"
      matter_status: "intake" | "active" | "on_hold" | "closed" | "archived"
      matter_type:
        | "litigation"
        | "criminal"
        | "civil"
        | "commercial"
        | "labor"
        | "family"
        | "constitutional"
        | "administrative"
        | "corporate"
        | "tax"
        | "immigration"
        | "contract"
        | "advisory"
        | "compliance"
        | "transaction"
      membership_status: "active" | "invited" | "suspended"
      org_role:
        | "owner"
        | "admin"
        | "lawyer"
        | "paralegal"
        | "viewer"
        | "firm_administrator"
        | "attorney"
        | "associate_attorney"
        | "legal_assistant"
        | "client"
        | "read_only"
      task_status: "todo" | "in_progress" | "blocked" | "done" | "cancelled"
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
      app_role: ["admin", "moderator", "user", "super_admin", "platform_admin"],
      doc_processing_status: [
        "pending",
        "uploading",
        "uploaded",
        "extracting",
        "extracted",
        "classifying",
        "classified",
        "analyzing",
        "analyzed",
        "failed",
      ],
      intelligence_engine: [
        "legal",
        "case",
        "evidence",
        "witness",
        "timeline",
        "litigation",
        "contract",
        "research",
        "work_product",
      ],
      matter_priority: ["low", "normal", "high", "urgent"],
      matter_status: ["intake", "active", "on_hold", "closed", "archived"],
      matter_type: [
        "litigation",
        "criminal",
        "civil",
        "commercial",
        "labor",
        "family",
        "constitutional",
        "administrative",
        "corporate",
        "tax",
        "immigration",
        "contract",
        "advisory",
        "compliance",
        "transaction",
      ],
      membership_status: ["active", "invited", "suspended"],
      org_role: [
        "owner",
        "admin",
        "lawyer",
        "paralegal",
        "viewer",
        "firm_administrator",
        "attorney",
        "associate_attorney",
        "legal_assistant",
        "client",
        "read_only",
      ],
      task_status: ["todo", "in_progress", "blocked", "done", "cancelled"],
    },
  },
} as const
