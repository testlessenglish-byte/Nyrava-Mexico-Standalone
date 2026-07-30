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
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          meta: Json
          target: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          meta?: Json
          target?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          meta?: Json
          target?: string | null
        }
        Relationships: []
      }
      agent_configs: {
        Row: {
          agent_key: string
          confidence_threshold: number
          created_at: string
          display_name: string
          enabled: boolean
          id: string
          retries: number
          run_order: number
          timeout_ms: number
          updated_at: string
        }
        Insert: {
          agent_key: string
          confidence_threshold?: number
          created_at?: string
          display_name: string
          enabled?: boolean
          id?: string
          retries?: number
          run_order: number
          timeout_ms?: number
          updated_at?: string
        }
        Update: {
          agent_key?: string
          confidence_threshold?: number
          created_at?: string
          display_name?: string
          enabled?: boolean
          id?: string
          retries?: number
          run_order?: number
          timeout_ms?: number
          updated_at?: string
        }
        Relationships: []
      }
      agent_findings: {
        Row: {
          agent_type: string
          case_id: string
          confidence: number | null
          created_at: string
          error: string | null
          findings: Json | null
          grounding_dropped_count: number | null
          id: string
          latency_ms: number | null
          status: string
          summary: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_type: string
          case_id: string
          confidence?: number | null
          created_at?: string
          error?: string | null
          findings?: Json | null
          grounding_dropped_count?: number | null
          id?: string
          latency_ms?: number | null
          status?: string
          summary?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_type?: string
          case_id?: string
          confidence?: number | null
          created_at?: string
          error?: string | null
          findings?: Json | null
          grounding_dropped_count?: number | null
          id?: string
          latency_ms?: number | null
          status?: string
          summary?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_findings_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_logs: {
        Row: {
          agent_index: number
          agent_key: string
          agent_name: string
          case_id: string
          confidence: number | null
          created_at: string
          documents_analyzed: number
          errors: Json | null
          findings_generated: number
          findings_produced: number
          findings_promoted: number
          findings_suppressed: number
          finished_at: string | null
          id: string
          no_output_reason: string | null
          output: Json | null
          output_file: string | null
          output_items: number
          processing_time_ms: number | null
          run_id: string
          started_at: string
          status: string
          tokens_used: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_index: number
          agent_key: string
          agent_name: string
          case_id: string
          confidence?: number | null
          created_at?: string
          documents_analyzed?: number
          errors?: Json | null
          findings_generated?: number
          findings_produced?: number
          findings_promoted?: number
          findings_suppressed?: number
          finished_at?: string | null
          id?: string
          no_output_reason?: string | null
          output?: Json | null
          output_file?: string | null
          output_items?: number
          processing_time_ms?: number | null
          run_id: string
          started_at?: string
          status: string
          tokens_used?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_index?: number
          agent_key?: string
          agent_name?: string
          case_id?: string
          confidence?: number | null
          created_at?: string
          documents_analyzed?: number
          errors?: Json | null
          findings_generated?: number
          findings_produced?: number
          findings_promoted?: number
          findings_suppressed?: number
          finished_at?: string | null
          id?: string
          no_output_reason?: string | null
          output?: Json | null
          output_file?: string | null
          output_items?: number
          processing_time_ms?: number | null
          run_id?: string
          started_at?: string
          status?: string
          tokens_used?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_logs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_providers: {
        Row: {
          api_key_encrypted: string | null
          base_url: string | null
          config: Json
          created_at: string
          default_model: string | null
          display_name: string
          enabled: boolean
          id: string
          last_error: string | null
          last_error_at: string | null
          last_ok_at: string | null
          priority: number
          provider_type: string
          secret_name: string | null
          updated_at: string
        }
        Insert: {
          api_key_encrypted?: string | null
          base_url?: string | null
          config?: Json
          created_at?: string
          default_model?: string | null
          display_name: string
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_ok_at?: string | null
          priority?: number
          provider_type: string
          secret_name?: string | null
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string | null
          base_url?: string | null
          config?: Json
          created_at?: string
          default_model?: string | null
          display_name?: string
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_ok_at?: string | null
          priority?: number
          provider_type?: string
          secret_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_task_routing: {
        Row: {
          created_at: string
          id: string
          model: string | null
          provider_id: string | null
          task: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          model?: string | null
          provider_id?: string | null
          task: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          model?: string | null
          provider_id?: string | null
          task?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_task_routing_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          case_id: string | null
          created_at: string
          error: string | null
          groq_key_id: string | null
          id: string
          input_tokens: number | null
          latency_ms: number | null
          model: string
          operation: string
          output_tokens: number | null
          provider_type: string | null
          success: boolean
          total_tokens: number | null
          user_id: string
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          error?: string | null
          groq_key_id?: string | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model: string
          operation: string
          output_tokens?: number | null
          provider_type?: string | null
          success?: boolean
          total_tokens?: number | null
          user_id: string
        }
        Update: {
          case_id?: string | null
          created_at?: string
          error?: string | null
          groq_key_id?: string | null
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string
          operation?: string
          output_tokens?: number | null
          provider_type?: string | null
          success?: boolean
          total_tokens?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      analyses: {
        Row: {
          case_id: string
          contradictions: Json | null
          created_at: string
          evidence_relationships: Json | null
          key_findings: Json | null
          missing_evidence: Json | null
          procedural_issues: Json | null
          scoring: Json | null
          timeline: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          case_id: string
          contradictions?: Json | null
          created_at?: string
          evidence_relationships?: Json | null
          key_findings?: Json | null
          missing_evidence?: Json | null
          procedural_issues?: Json | null
          scoring?: Json | null
          timeline?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          case_id?: string
          contradictions?: Json | null
          created_at?: string
          evidence_relationships?: Json | null
          key_findings?: Json | null
          missing_evidence?: Json | null
          procedural_issues?: Json | null
          scoring?: Json | null
          timeline?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyses_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
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
      audit_logs: {
        Row: {
          action: string
          case_id: string | null
          created_at: string
          document_id: string | null
          id: string
          level: string
          message: string | null
          metadata: Json
          stage: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          case_id?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          level?: string
          message?: string | null
          metadata?: Json
          stage?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          case_id?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          level?: string
          message?: string | null
          metadata?: Json
          stage?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      authority_relationships: {
        Row: {
          created_at: string
          from_id: string
          from_type: string
          id: string
          relationship: string
          to_id: string
          to_type: string
        }
        Insert: {
          created_at?: string
          from_id: string
          from_type: string
          id?: string
          relationship: string
          to_id: string
          to_type: string
        }
        Update: {
          created_at?: string
          from_id?: string
          from_type?: string
          id?: string
          relationship?: string
          to_id?: string
          to_type?: string
        }
        Relationships: []
      }
      beta_invites: {
        Row: {
          email: string
          invited_at: string
          invited_by: string | null
          note: string | null
          redeemed_at: string | null
          redeemed_user_id: string | null
        }
        Insert: {
          email: string
          invited_at?: string
          invited_by?: string | null
          note?: string | null
          redeemed_at?: string | null
          redeemed_user_id?: string | null
        }
        Update: {
          email?: string
          invited_at?: string
          invited_by?: string | null
          note?: string | null
          redeemed_at?: string | null
          redeemed_user_id?: string | null
        }
        Relationships: []
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
      billing_plan_notes: {
        Row: {
          created_at: string
          notes: string | null
          plan_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          notes?: string | null
          plan_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          notes?: string | null
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_plan_notes_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plans: {
        Row: {
          active: boolean
          code: string
          contact_url: string | null
          created_at: string
          currency: string
          description: string | null
          features: Json
          id: string
          included_seats: number
          interval: string
          key: string | null
          label: string | null
          name: string
          per_seat_price_cents: number | null
          per_seat_stripe_price_id: string | null
          price_cents: number
          self_serve: boolean
          sort_order: number
          stripe_price_id: string | null
          tagline: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          contact_url?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          included_seats?: number
          interval?: string
          key?: string | null
          label?: string | null
          name: string
          per_seat_price_cents?: number | null
          per_seat_stripe_price_id?: string | null
          price_cents?: number
          self_serve?: boolean
          sort_order?: number
          stripe_price_id?: string | null
          tagline?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          contact_url?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          included_seats?: number
          interval?: string
          key?: string | null
          label?: string | null
          name?: string
          per_seat_price_cents?: number | null
          per_seat_stripe_price_id?: string | null
          price_cents?: number
          self_serve?: boolean
          sort_order?: number
          stripe_price_id?: string | null
          tagline?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      canonical_analysis: {
        Row: {
          analysis_payload: Json
          case_id: string
          created_at: string
          id: string
          pipeline_stages: Json
          status: Database["public"]["Enums"]["canonical_status"]
          updated_at: string
          validation_errors: Json
          version: number
        }
        Insert: {
          analysis_payload?: Json
          case_id: string
          created_at?: string
          id?: string
          pipeline_stages?: Json
          status?: Database["public"]["Enums"]["canonical_status"]
          updated_at?: string
          validation_errors?: Json
          version?: number
        }
        Update: {
          analysis_payload?: Json
          case_id?: string
          created_at?: string
          id?: string
          pipeline_stages?: Json
          status?: Database["public"]["Enums"]["canonical_status"]
          updated_at?: string
          validation_errors?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "canonical_analysis_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_chat_messages: {
        Row: {
          case_id: string
          cited_finding_ids: string[] | null
          content: string
          created_at: string
          id: string
          message_language: string | null
          metadata: Json | null
          role: string
          user_id: string
        }
        Insert: {
          case_id: string
          cited_finding_ids?: string[] | null
          content: string
          created_at?: string
          id?: string
          message_language?: string | null
          metadata?: Json | null
          role: string
          user_id: string
        }
        Update: {
          case_id?: string
          cited_finding_ids?: string[] | null
          content?: string
          created_at?: string
          id?: string
          message_language?: string | null
          metadata?: Json | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_chat_messages_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_communications: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body: string
          case_id: string
          channel: string
          created_at: string
          direction: string
          id: string
          status: string
          subject: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body: string
          case_id: string
          channel?: string
          created_at?: string
          direction?: string
          id?: string
          status?: string
          subject?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          case_id?: string
          channel?: string
          created_at?: string
          direction?: string
          id?: string
          status?: string
          subject?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_communications_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_domain_activations: {
        Row: {
          case_id: string
          created_at: string
          domain: string
          evidence_finding_ids: string[]
          id: string
          reason: string
          source: string
          trigger_id: string | null
        }
        Insert: {
          case_id: string
          created_at?: string
          domain: string
          evidence_finding_ids?: string[]
          id?: string
          reason: string
          source: string
          trigger_id?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string
          domain?: string
          evidence_finding_ids?: string[]
          id?: string
          reason?: string
          source?: string
          trigger_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_domain_activations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_events: {
        Row: {
          case_id: string
          created_at: string
          event_type: string
          id: string
          location: string | null
          notes: string | null
          scheduled_at: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          event_type?: string
          id?: string
          location?: string | null
          notes?: string | null
          scheduled_at: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          event_type?: string
          id?: string
          location?: string | null
          notes?: string | null
          scheduled_at?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_findings: {
        Row: {
          affected_party: string | null
          authority_level: number
          canonical_finding_id: string | null
          case_id: string
          category: string
          category_key: string | null
          citation_quality: number | null
          confidence: number
          created_at: string
          derived_from_finding_ids: string[]
          description: string
          evidence_refs: Json | null
          evidence_strength: number | null
          evidence_type: string | null
          finding_status: string
          finding_type: string | null
          id: string
          impact_direction: string | null
          legal_significance: string | null
          metadata: Json | null
          potential_impact: string | null
          priority: number | null
          projected_from_row_id: string | null
          projected_from_table: string | null
          related_finding_ids: string[] | null
          severity: string
          source_doc_ids: string[] | null
          source_document_id: string | null
          source_module: string
          source_page: number | null
          source_quote: string | null
          strategic_significance: string | null
          supporting_engines: string[]
          tags: string[] | null
          title: string
          updated_at: string
          user_id: string
          verification_notes: string | null
          verification_status: string
          verified_at: string | null
        }
        Insert: {
          affected_party?: string | null
          authority_level?: number
          canonical_finding_id?: string | null
          case_id: string
          category: string
          category_key?: string | null
          citation_quality?: number | null
          confidence?: number
          created_at?: string
          derived_from_finding_ids?: string[]
          description: string
          evidence_refs?: Json | null
          evidence_strength?: number | null
          evidence_type?: string | null
          finding_status?: string
          finding_type?: string | null
          id?: string
          impact_direction?: string | null
          legal_significance?: string | null
          metadata?: Json | null
          potential_impact?: string | null
          priority?: number | null
          projected_from_row_id?: string | null
          projected_from_table?: string | null
          related_finding_ids?: string[] | null
          severity?: string
          source_doc_ids?: string[] | null
          source_document_id?: string | null
          source_module: string
          source_page?: number | null
          source_quote?: string | null
          strategic_significance?: string | null
          supporting_engines?: string[]
          tags?: string[] | null
          title: string
          updated_at?: string
          user_id: string
          verification_notes?: string | null
          verification_status?: string
          verified_at?: string | null
        }
        Update: {
          affected_party?: string | null
          authority_level?: number
          canonical_finding_id?: string | null
          case_id?: string
          category?: string
          category_key?: string | null
          citation_quality?: number | null
          confidence?: number
          created_at?: string
          derived_from_finding_ids?: string[]
          description?: string
          evidence_refs?: Json | null
          evidence_strength?: number | null
          evidence_type?: string | null
          finding_status?: string
          finding_type?: string | null
          id?: string
          impact_direction?: string | null
          legal_significance?: string | null
          metadata?: Json | null
          potential_impact?: string | null
          priority?: number | null
          projected_from_row_id?: string | null
          projected_from_table?: string | null
          related_finding_ids?: string[] | null
          severity?: string
          source_doc_ids?: string[] | null
          source_document_id?: string | null
          source_module?: string
          source_page?: number | null
          source_quote?: string | null
          strategic_significance?: string | null
          supporting_engines?: string[]
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
          verification_notes?: string | null
          verification_status?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_findings_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_motion_drafts: {
        Row: {
          attorney_notes: string
          body_markdown: string
          case_id: string
          created_at: string
          error_message: string | null
          id: string
          motion_title: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attorney_notes?: string
          body_markdown?: string
          case_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          motion_title: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attorney_notes?: string
          body_markdown?: string
          case_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          motion_title?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_motion_drafts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_opportunities: {
        Row: {
          case_id: string
          citations: Json | null
          confidence: number | null
          counter_response: string | null
          created_at: string
          description: string
          finding_type: string | null
          id: string
          opportunity_type: string
          recommended_investigations: Json | null
          recommended_motions: Json | null
          recommended_questions: Json | null
          severity: string | null
          side: string
          source_finding_ids: string[] | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          case_id: string
          citations?: Json | null
          confidence?: number | null
          counter_response?: string | null
          created_at?: string
          description: string
          finding_type?: string | null
          id?: string
          opportunity_type: string
          recommended_investigations?: Json | null
          recommended_motions?: Json | null
          recommended_questions?: Json | null
          severity?: string | null
          side: string
          source_finding_ids?: string[] | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          case_id?: string
          citations?: Json | null
          confidence?: number | null
          counter_response?: string | null
          created_at?: string
          description?: string
          finding_type?: string | null
          id?: string
          opportunity_type?: string
          recommended_investigations?: Json | null
          recommended_motions?: Json | null
          recommended_questions?: Json | null
          severity?: string | null
          side?: string
          source_finding_ids?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_opportunities_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_parties: {
        Row: {
          case_id: string
          contact: Json
          created_at: string
          id: string
          name: string
          party_role: string
          role_description: string | null
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          case_id: string
          contact?: Json
          created_at?: string
          id?: string
          name: string
          party_role?: string
          role_description?: string | null
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          case_id?: string
          contact?: Json
          created_at?: string
          id?: string
          name?: string
          party_role?: string
          role_description?: string | null
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_parties_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_perspectives: {
        Row: {
          case_id: string
          confidence: number | null
          confidence_label: string | null
          counter_arguments: Json | null
          created_at: string
          finding_type: string | null
          id: string
          key_evidence: Json | null
          opposing_arguments: Json | null
          perspective: string
          recommended_actions: Json | null
          risk_score: number | null
          strength_score: number | null
          strengths: Json | null
          summary: string | null
          updated_at: string
          user_id: string
          weaknesses: Json | null
        }
        Insert: {
          case_id: string
          confidence?: number | null
          confidence_label?: string | null
          counter_arguments?: Json | null
          created_at?: string
          finding_type?: string | null
          id?: string
          key_evidence?: Json | null
          opposing_arguments?: Json | null
          perspective: string
          recommended_actions?: Json | null
          risk_score?: number | null
          strength_score?: number | null
          strengths?: Json | null
          summary?: string | null
          updated_at?: string
          user_id: string
          weaknesses?: Json | null
        }
        Update: {
          case_id?: string
          confidence?: number | null
          confidence_label?: string | null
          counter_arguments?: Json | null
          created_at?: string
          finding_type?: string | null
          id?: string
          key_evidence?: Json | null
          opposing_arguments?: Json | null
          perspective?: string
          recommended_actions?: Json | null
          risk_score?: number | null
          strength_score?: number | null
          strengths?: Json | null
          summary?: string | null
          updated_at?: string
          user_id?: string
          weaknesses?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "case_perspectives_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_scores: {
        Row: {
          appeal_risk: number | null
          case_id: string
          case_quality: number | null
          chain_of_custody: number | null
          constitutional_compliance: number | null
          conviction_risk: number | null
          created_at: string
          dimension_breakdowns: Json | null
          evidence_strength: number | null
          investigation_completeness: number | null
          methodology: string | null
          negative_contributors: Json | null
          overall_confidence: number | null
          positive_contributors: Json | null
          rationale: Json | null
          source_finding_ids: string[] | null
          timeline_integrity: number | null
          updated_at: string
          user_id: string
          witness_reliability: number | null
        }
        Insert: {
          appeal_risk?: number | null
          case_id: string
          case_quality?: number | null
          chain_of_custody?: number | null
          constitutional_compliance?: number | null
          conviction_risk?: number | null
          created_at?: string
          dimension_breakdowns?: Json | null
          evidence_strength?: number | null
          investigation_completeness?: number | null
          methodology?: string | null
          negative_contributors?: Json | null
          overall_confidence?: number | null
          positive_contributors?: Json | null
          rationale?: Json | null
          source_finding_ids?: string[] | null
          timeline_integrity?: number | null
          updated_at?: string
          user_id: string
          witness_reliability?: number | null
        }
        Update: {
          appeal_risk?: number | null
          case_id?: string
          case_quality?: number | null
          chain_of_custody?: number | null
          constitutional_compliance?: number | null
          conviction_risk?: number | null
          created_at?: string
          dimension_breakdowns?: Json | null
          evidence_strength?: number | null
          investigation_completeness?: number | null
          methodology?: string | null
          negative_contributors?: Json | null
          overall_confidence?: number | null
          positive_contributors?: Json | null
          rationale?: Json | null
          source_finding_ids?: string[] | null
          timeline_integrity?: number | null
          updated_at?: string
          user_id?: string
          witness_reliability?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "case_scores_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_strategy: {
        Row: {
          anticipated_opposing: Json | null
          case_id: string
          case_strength_score: number | null
          confidence_label: string | null
          counter_arguments: Json | null
          created_at: string
          id: string
          motion_rankings: Json | null
          next_actions: Json | null
          perspective: string
          risk_score: number | null
          summary: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          anticipated_opposing?: Json | null
          case_id: string
          case_strength_score?: number | null
          confidence_label?: string | null
          counter_arguments?: Json | null
          created_at?: string
          id?: string
          motion_rankings?: Json | null
          next_actions?: Json | null
          perspective?: string
          risk_score?: number | null
          summary?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          anticipated_opposing?: Json | null
          case_id?: string
          case_strength_score?: number | null
          confidence_label?: string | null
          counter_arguments?: Json | null
          created_at?: string
          id?: string
          motion_rankings?: Json | null
          next_actions?: Json | null
          perspective?: string
          risk_score?: number | null
          summary?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_strategy_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_strategy_center: {
        Row: {
          biggest_evidentiary_gap: Json | null
          biggest_trial_risk: Json | null
          biggest_weakness: Json | null
          case_id: string
          created_at: string
          expected_defense: Json | null
          generated_at: string | null
          lead_counsel_assessment: string | null
          most_dangerous_witness: Json | null
          primary_trial_theme: Json | null
          recommended_counter_strategy: string | null
          settlement_leverage: Json | null
          updated_at: string
          user_id: string
          weekly_priorities: Json | null
          winning_the_case_dashboard: Json | null
        }
        Insert: {
          biggest_evidentiary_gap?: Json | null
          biggest_trial_risk?: Json | null
          biggest_weakness?: Json | null
          case_id: string
          created_at?: string
          expected_defense?: Json | null
          generated_at?: string | null
          lead_counsel_assessment?: string | null
          most_dangerous_witness?: Json | null
          primary_trial_theme?: Json | null
          recommended_counter_strategy?: string | null
          settlement_leverage?: Json | null
          updated_at?: string
          user_id: string
          weekly_priorities?: Json | null
          winning_the_case_dashboard?: Json | null
        }
        Update: {
          biggest_evidentiary_gap?: Json | null
          biggest_trial_risk?: Json | null
          biggest_weakness?: Json | null
          case_id?: string
          created_at?: string
          expected_defense?: Json | null
          generated_at?: string | null
          lead_counsel_assessment?: string | null
          most_dangerous_witness?: Json | null
          primary_trial_theme?: Json | null
          recommended_counter_strategy?: string | null
          settlement_leverage?: Json | null
          updated_at?: string
          user_id?: string
          weekly_priorities?: Json | null
          winning_the_case_dashboard?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "case_strategy_center_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_tasks: {
        Row: {
          assignee_hint: string | null
          case_id: string
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          priority: string
          status: string
          template_key: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assignee_hint?: string | null
          case_id: string
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          status?: string
          template_key?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assignee_hint?: string | null
          case_id?: string
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          status?: string
          template_key?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_tasks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_theories: {
        Row: {
          case_id: string
          citations: Json | null
          confidence: number | null
          contradicting_evidence: Json | null
          created_at: string
          finding_type: string | null
          id: string
          key_assumptions: Json | null
          missing_evidence: Json | null
          narrative: string
          risk: string | null
          supporting_evidence: Json | null
          theory_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          case_id: string
          citations?: Json | null
          confidence?: number | null
          contradicting_evidence?: Json | null
          created_at?: string
          finding_type?: string | null
          id?: string
          key_assumptions?: Json | null
          missing_evidence?: Json | null
          narrative: string
          risk?: string | null
          supporting_evidence?: Json | null
          theory_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          case_id?: string
          citations?: Json | null
          confidence?: number | null
          contradicting_evidence?: Json | null
          created_at?: string
          finding_type?: string | null
          id?: string
          key_assumptions?: Json | null
          missing_evidence?: Json | null
          narrative?: string
          risk?: string | null
          supporting_evidence?: Json | null
          theory_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_theories_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_timeline_events: {
        Row: {
          canonical_id: string
          case_id: string
          created_at: string
          description: string | null
          event_date: string | null
          id: string
          source_document_id: string | null
          source_page: number | null
          superseded_by: string | null
          updated_at: string
        }
        Insert: {
          canonical_id: string
          case_id: string
          created_at?: string
          description?: string | null
          event_date?: string | null
          id?: string
          source_document_id?: string | null
          source_page?: number | null
          superseded_by?: string | null
          updated_at?: string
        }
        Update: {
          canonical_id?: string
          case_id?: string
          created_at?: string
          description?: string | null
          event_date?: string | null
          id?: string
          source_document_id?: string | null
          source_page?: number | null
          superseded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_timeline_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_timeline_events_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_timeline_events_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "case_timeline_events"
            referencedColumns: ["id"]
          },
        ]
      }
      case_trial_prep: {
        Row: {
          case_id: string
          case_type: string | null
          civil_metrics: Json | null
          closing_themes: Json | null
          created_at: string
          exhibit_order: Json | null
          jury_acquittal_pct: number | null
          jury_appeal_pct: number | null
          jury_concerns: Json | null
          jury_conviction_pct: number | null
          jury_settlement_pct: number | null
          likely_objections: Json | null
          most_damaging_evidence: Json | null
          most_persuasive_evidence: Json | null
          opening_themes: Json | null
          penal_metrics: Json | null
          trial_risks: Json | null
          trial_strengths: Json | null
          updated_at: string
          user_id: string
          witness_order: Json | null
        }
        Insert: {
          case_id: string
          case_type?: string | null
          civil_metrics?: Json | null
          closing_themes?: Json | null
          created_at?: string
          exhibit_order?: Json | null
          jury_acquittal_pct?: number | null
          jury_appeal_pct?: number | null
          jury_concerns?: Json | null
          jury_conviction_pct?: number | null
          jury_settlement_pct?: number | null
          likely_objections?: Json | null
          most_damaging_evidence?: Json | null
          most_persuasive_evidence?: Json | null
          opening_themes?: Json | null
          penal_metrics?: Json | null
          trial_risks?: Json | null
          trial_strengths?: Json | null
          updated_at?: string
          user_id: string
          witness_order?: Json | null
        }
        Update: {
          case_id?: string
          case_type?: string | null
          civil_metrics?: Json | null
          closing_themes?: Json | null
          created_at?: string
          exhibit_order?: Json | null
          jury_acquittal_pct?: number | null
          jury_appeal_pct?: number | null
          jury_concerns?: Json | null
          jury_conviction_pct?: number | null
          jury_settlement_pct?: number | null
          likely_objections?: Json | null
          most_damaging_evidence?: Json | null
          most_persuasive_evidence?: Json | null
          opening_themes?: Json | null
          penal_metrics?: Json | null
          trial_risks?: Json | null
          trial_strengths?: Json | null
          updated_at?: string
          user_id?: string
          witness_order?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "case_trial_prep_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_witnesses: {
        Row: {
          bias: number | null
          case_id: string
          citations: Json | null
          consistency: number | null
          corroboration: number | null
          created_at: string
          credibility_risk: number | null
          cross_exam_questions: Json | null
          finding_type: string | null
          follow_up_questions: Json | null
          id: string
          impeachment_questions: Json | null
          name: string
          observation_opportunity: number | null
          rationale: Json | null
          reliability: number | null
          role: string | null
          source_doc_ids: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bias?: number | null
          case_id: string
          citations?: Json | null
          consistency?: number | null
          corroboration?: number | null
          created_at?: string
          credibility_risk?: number | null
          cross_exam_questions?: Json | null
          finding_type?: string | null
          follow_up_questions?: Json | null
          id?: string
          impeachment_questions?: Json | null
          name: string
          observation_opportunity?: number | null
          rationale?: Json | null
          reliability?: number | null
          role?: string | null
          source_doc_ids?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bias?: number | null
          case_id?: string
          citations?: Json | null
          consistency?: number | null
          corroboration?: number | null
          created_at?: string
          credibility_risk?: number | null
          cross_exam_questions?: Json | null
          finding_type?: string | null
          follow_up_questions?: Json | null
          id?: string
          impeachment_questions?: Json | null
          name?: string
          observation_opportunity?: number | null
          rationale?: Json | null
          reliability?: number | null
          role?: string | null
          source_doc_ids?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_witnesses_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_work_product: {
        Row: {
          body_markdown: string
          case_id: string
          cited_finding_ids: string[] | null
          created_at: string
          document_type: string
          error_message: string | null
          generation_failed: boolean
          id: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body_markdown: string
          case_id: string
          cited_finding_ids?: string[] | null
          created_at?: string
          document_type: string
          error_message?: string | null
          generation_failed?: boolean
          id?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body_markdown?: string
          case_id?: string
          cited_finding_ids?: string[] | null
          created_at?: string
          document_type?: string
          error_message?: string | null
          generation_failed?: boolean
          id?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_work_product_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          additional_domains: string[]
          agents_at: string | null
          analysis_at: string | null
          analysis_mode: string
          archived_at: string | null
          attack_surface: Json
          cancel_requested: boolean
          case_language: string | null
          case_type: string | null
          completed_at: string | null
          contradiction_at: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          discovery_at: string | null
          error: string | null
          evidence_intel_at: string | null
          extracted_at: string | null
          extraction_report: Json | null
          firm_id: string | null
          hallucination_at: string | null
          hallucination_report: Json | null
          id: string
          jurisdiction: string | null
          jurisdiction_profile: Json | null
          legal_qa_report: Json | null
          lifecycle_status: string | null
          name: string
          next_stage: string | null
          opportunities_at: string | null
          perspectives_at: string | null
          procedural_compliance: Json | null
          progress: number
          queued_at: string | null
          report_at: string | null
          report_checkpoint_count: number
          report_language: string
          scored_at: string | null
          shared_brief: Json | null
          shared_brief_at: string | null
          stall_reason: string | null
          status: Database["public"]["Enums"]["case_status"]
          status_message: string | null
          strategy_at: string | null
          strategy_center_at: string | null
          theories_at: string | null
          trial_prep_at: string | null
          updated_at: string
          user_id: string
          witnesses_at: string | null
          work_product_at: string | null
          worker_lease_until: string | null
        }
        Insert: {
          additional_domains?: string[]
          agents_at?: string | null
          analysis_at?: string | null
          analysis_mode?: string
          archived_at?: string | null
          attack_surface?: Json
          cancel_requested?: boolean
          case_language?: string | null
          case_type?: string | null
          completed_at?: string | null
          contradiction_at?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          discovery_at?: string | null
          error?: string | null
          evidence_intel_at?: string | null
          extracted_at?: string | null
          extraction_report?: Json | null
          firm_id?: string | null
          hallucination_at?: string | null
          hallucination_report?: Json | null
          id?: string
          jurisdiction?: string | null
          jurisdiction_profile?: Json | null
          legal_qa_report?: Json | null
          lifecycle_status?: string | null
          name: string
          next_stage?: string | null
          opportunities_at?: string | null
          perspectives_at?: string | null
          procedural_compliance?: Json | null
          progress?: number
          queued_at?: string | null
          report_at?: string | null
          report_checkpoint_count?: number
          report_language?: string
          scored_at?: string | null
          shared_brief?: Json | null
          shared_brief_at?: string | null
          stall_reason?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          status_message?: string | null
          strategy_at?: string | null
          strategy_center_at?: string | null
          theories_at?: string | null
          trial_prep_at?: string | null
          updated_at?: string
          user_id: string
          witnesses_at?: string | null
          work_product_at?: string | null
          worker_lease_until?: string | null
        }
        Update: {
          additional_domains?: string[]
          agents_at?: string | null
          analysis_at?: string | null
          analysis_mode?: string
          archived_at?: string | null
          attack_surface?: Json
          cancel_requested?: boolean
          case_language?: string | null
          case_type?: string | null
          completed_at?: string | null
          contradiction_at?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          discovery_at?: string | null
          error?: string | null
          evidence_intel_at?: string | null
          extracted_at?: string | null
          extraction_report?: Json | null
          firm_id?: string | null
          hallucination_at?: string | null
          hallucination_report?: Json | null
          id?: string
          jurisdiction?: string | null
          jurisdiction_profile?: Json | null
          legal_qa_report?: Json | null
          lifecycle_status?: string | null
          name?: string
          next_stage?: string | null
          opportunities_at?: string | null
          perspectives_at?: string | null
          procedural_compliance?: Json | null
          progress?: number
          queued_at?: string | null
          report_at?: string | null
          report_checkpoint_count?: number
          report_language?: string
          scored_at?: string | null
          shared_brief?: Json | null
          shared_brief_at?: string | null
          stall_reason?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          status_message?: string | null
          strategy_at?: string | null
          strategy_center_at?: string | null
          theories_at?: string | null
          trial_prep_at?: string | null
          updated_at?: string
          user_id?: string
          witnesses_at?: string | null
          work_product_at?: string | null
          worker_lease_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cases_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      citation_cache: {
        Row: {
          citation_text: string
          id: string
          last_checked_at: string
          resolved_article_id: string | null
          resolved_authority_id: string | null
          verification_status: Database["public"]["Enums"]["legal_verification_status"]
        }
        Insert: {
          citation_text: string
          id?: string
          last_checked_at?: string
          resolved_article_id?: string | null
          resolved_authority_id?: string | null
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
        }
        Update: {
          citation_text?: string
          id?: string
          last_checked_at?: string
          resolved_article_id?: string | null
          resolved_authority_id?: string | null
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "citation_cache_resolved_article_id_fkey"
            columns: ["resolved_article_id"]
            isOneToOne: false
            referencedRelation: "legal_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citation_cache_resolved_authority_id_fkey"
            columns: ["resolved_authority_id"]
            isOneToOne: false
            referencedRelation: "legal_authorities"
            referencedColumns: ["id"]
          },
        ]
      }
      closing_milestones: {
        Row: {
          case_id: string
          created_at: string
          id: string
          label_en: string
          label_es: string
          milestone_key: string
          percent_complete: number
          updated_at: string
          user_id: string
          weight: number
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          label_en: string
          label_es: string
          milestone_key: string
          percent_complete?: number
          updated_at?: string
          user_id: string
          weight?: number
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          label_en?: string
          label_es?: string
          milestone_key?: string
          percent_complete?: number
          updated_at?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "closing_milestones_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_case_documents: {
        Row: {
          created_at: string
          demo_case_id: string
          doc_type: string
          file_name: string
          file_size: number
          id: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          demo_case_id: string
          doc_type: string
          file_name: string
          file_size?: number
          id?: string
          sort_order?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          demo_case_id?: string
          doc_type?: string
          file_name?: string
          file_size?: number
          id?: string
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_case_documents_demo_case_id_fkey"
            columns: ["demo_case_id"]
            isOneToOne: false
            referencedRelation: "demo_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_cases: {
        Row: {
          case_type: string
          created_at: string
          description: string
          id: string
          name: string
          published: boolean
          slug: string
          sort_order: number
          summary: string
          thumbnail_path: string | null
          updated_at: string
        }
        Insert: {
          case_type: string
          created_at?: string
          description?: string
          id?: string
          name: string
          published?: boolean
          slug: string
          sort_order?: number
          summary?: string
          thumbnail_path?: string | null
          updated_at?: string
        }
        Update: {
          case_type?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          published?: boolean
          slug?: string
          sort_order?: number
          summary?: string
          thumbnail_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      document_pages: {
        Row: {
          case_id: string
          char_count: number
          created_at: string
          document_id: string
          id: string
          page: number
          text: string
          user_id: string
        }
        Insert: {
          case_id: string
          char_count?: number
          created_at?: string
          document_id: string
          id?: string
          page: number
          text?: string
          user_id: string
        }
        Update: {
          case_id?: string
          char_count?: number
          created_at?: string
          document_id?: string
          id?: string
          page?: number
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_pages_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_pages_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
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
      documents: {
        Row: {
          archived_at: string | null
          case_id: string
          content_hash: string
          created_at: string
          entities: Json
          error: string | null
          extracted_text: string | null
          extraction_retry_count: number
          filename: string
          id: string
          last_extraction_attempt_at: string | null
          metadata: Json
          mime_type: string | null
          size_bytes: number | null
          status: Database["public"]["Enums"]["doc_status"]
          storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          case_id: string
          content_hash: string
          created_at?: string
          entities?: Json
          error?: string | null
          extracted_text?: string | null
          extraction_retry_count?: number
          filename: string
          id?: string
          last_extraction_attempt_at?: string | null
          metadata?: Json
          mime_type?: string | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["doc_status"]
          storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          case_id?: string
          content_hash?: string
          created_at?: string
          entities?: Json
          error?: string | null
          extracted_text?: string | null
          extraction_retry_count?: number
          filename?: string
          id?: string
          last_extraction_attempt_at?: string | null
          metadata?: Json
          mime_type?: string | null
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["doc_status"]
          storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_classifications: {
        Row: {
          affected_party: string | null
          case_id: string
          citations: Json | null
          classification: string
          confidence: number | null
          confidence_label: string | null
          contradicts_finding_ids: Json
          created_at: string
          description: string | null
          document_id: string | null
          id: string
          linked_timeline_event_ids: Json
          linked_witness_ids: Json
          referenced_by_doc_ids: Json
          severity: string | null
          supports_finding_ids: Json
          title: string
          user_id: string
        }
        Insert: {
          affected_party?: string | null
          case_id: string
          citations?: Json | null
          classification: string
          confidence?: number | null
          confidence_label?: string | null
          contradicts_finding_ids?: Json
          created_at?: string
          description?: string | null
          document_id?: string | null
          id?: string
          linked_timeline_event_ids?: Json
          linked_witness_ids?: Json
          referenced_by_doc_ids?: Json
          severity?: string | null
          supports_finding_ids?: Json
          title: string
          user_id: string
        }
        Update: {
          affected_party?: string | null
          case_id?: string
          citations?: Json | null
          classification?: string
          confidence?: number | null
          confidence_label?: string | null
          contradicts_finding_ids?: Json
          created_at?: string
          description?: string | null
          document_id?: string | null
          id?: string
          linked_timeline_event_ids?: Json
          linked_witness_ids?: Json
          referenced_by_doc_ids?: Json
          severity?: string | null
          supports_finding_ids?: Json
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_classifications_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_classifications_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          description: string | null
          enabled: boolean
          key: string
          updated_at: string
        }
        Insert: {
          description?: string | null
          enabled?: boolean
          key: string
          updated_at?: string
        }
        Update: {
          description?: string | null
          enabled?: boolean
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      firm_invites: {
        Row: {
          accepted_at: string | null
          email: string
          firm_id: string
          id: string
          invited_at: string
          invited_by: string
          redeemed_user_id: string | null
          role: string
          status: string
        }
        Insert: {
          accepted_at?: string | null
          email: string
          firm_id: string
          id?: string
          invited_at?: string
          invited_by: string
          redeemed_user_id?: string | null
          role?: string
          status?: string
        }
        Update: {
          accepted_at?: string | null
          email?: string
          firm_id?: string
          id?: string
          invited_at?: string
          invited_by?: string
          redeemed_user_id?: string | null
          role?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_invites_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firms: {
        Row: {
          created_at: string
          domain: string | null
          id: string
          name: string
          owner_user_id: string | null
          plan_key: string | null
          seat_limit: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          domain?: string | null
          id?: string
          name: string
          owner_user_id?: string | null
          plan_key?: string | null
          seat_limit?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          domain?: string | null
          id?: string
          name?: string
          owner_user_id?: string | null
          plan_key?: string | null
          seat_limit?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      image_intelligence: {
        Row: {
          case_id: string
          confidence: number | null
          created_at: string
          document_id: string | null
          face_count: number | null
          id: string
          objects: Json
          ocr_text: string | null
          page_number: number | null
          source_model: string | null
          summary: string | null
          text_found: string | null
        }
        Insert: {
          case_id: string
          confidence?: number | null
          created_at?: string
          document_id?: string | null
          face_count?: number | null
          id?: string
          objects?: Json
          ocr_text?: string | null
          page_number?: number | null
          source_model?: string | null
          summary?: string | null
          text_found?: string | null
        }
        Update: {
          case_id?: string
          confidence?: number | null
          created_at?: string
          document_id?: string | null
          face_count?: number | null
          id?: string
          objects?: Json
          ocr_text?: string | null
          page_number?: number | null
          source_model?: string | null
          summary?: string | null
          text_found?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "image_intelligence_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_intelligence_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
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
      legal_amendments: {
        Row: {
          amendment_type: string
          article_id: string
          created_at: string
          decree_reference: string | null
          effective_at: string | null
          id: string
          new_body: string
          previous_body: string | null
          source_url: string | null
        }
        Insert: {
          amendment_type?: string
          article_id: string
          created_at?: string
          decree_reference?: string | null
          effective_at?: string | null
          id?: string
          new_body: string
          previous_body?: string | null
          source_url?: string | null
        }
        Update: {
          amendment_type?: string
          article_id?: string
          created_at?: string
          decree_reference?: string | null
          effective_at?: string | null
          id?: string
          new_body?: string
          previous_body?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_amendments_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "legal_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_articles: {
        Row: {
          article_number: string
          authority_id: string
          body: string
          created_at: string
          effective_at: string | null
          heading: string | null
          id: string
          repealed_at: string | null
          source_url: string | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["legal_verification_status"]
        }
        Insert: {
          article_number: string
          authority_id: string
          body: string
          created_at?: string
          effective_at?: string | null
          heading?: string | null
          id?: string
          repealed_at?: string | null
          source_url?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
        }
        Update: {
          article_number?: string
          authority_id?: string
          body?: string
          created_at?: string
          effective_at?: string | null
          heading?: string | null
          id?: string
          repealed_at?: string | null
          source_url?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "legal_articles_authority_id_fkey"
            columns: ["authority_id"]
            isOneToOne: false
            referencedRelation: "legal_authorities"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_authorities: {
        Row: {
          authority_level: number | null
          body: string | null
          citation: string | null
          connector_code: string | null
          content_hash: string | null
          created_at: string
          effective_at: string | null
          id: string
          issuer: string | null
          jurisdiction: string | null
          kind: string
          metadata: Json
          published_at: string | null
          repealed_at: string | null
          short_title: string | null
          source_url: string | null
          superseded_by_id: string | null
          title: string
          updated_at: string
          verification_status: Database["public"]["Enums"]["legal_verification_status"]
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          authority_level?: number | null
          body?: string | null
          citation?: string | null
          connector_code?: string | null
          content_hash?: string | null
          created_at?: string
          effective_at?: string | null
          id?: string
          issuer?: string | null
          jurisdiction?: string | null
          kind: string
          metadata?: Json
          published_at?: string | null
          repealed_at?: string | null
          short_title?: string | null
          source_url?: string | null
          superseded_by_id?: string | null
          title: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          authority_level?: number | null
          body?: string | null
          citation?: string | null
          connector_code?: string | null
          content_hash?: string | null
          created_at?: string
          effective_at?: string | null
          id?: string
          issuer?: string | null
          jurisdiction?: string | null
          kind?: string
          metadata?: Json
          published_at?: string | null
          repealed_at?: string | null
          short_title?: string | null
          source_url?: string | null
          superseded_by_id?: string | null
          title?: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_authorities_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "legal_authorities"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_authority_versions: {
        Row: {
          archived_at: string
          authority_id: string
          body: string | null
          content_hash: string | null
          id: string
          metadata: Json
        }
        Insert: {
          archived_at?: string
          authority_id: string
          body?: string | null
          content_hash?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          archived_at?: string
          authority_id?: string
          body?: string | null
          content_hash?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "legal_authority_versions_authority_id_fkey"
            columns: ["authority_id"]
            isOneToOne: false
            referencedRelation: "legal_authorities"
            referencedColumns: ["id"]
          },
        ]
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
      legal_ingest_runs: {
        Row: {
          connector_code: string
          created_at: string
          documents_fetched: number
          documents_stored: number
          documents_versioned: number
          ended_at: string | null
          errors: Json
          id: string
          started_at: string
          status: string
        }
        Insert: {
          connector_code: string
          created_at?: string
          documents_fetched?: number
          documents_stored?: number
          documents_versioned?: number
          ended_at?: string | null
          errors?: Json
          id?: string
          started_at: string
          status: string
        }
        Update: {
          connector_code?: string
          created_at?: string
          documents_fetched?: number
          documents_stored?: number
          documents_versioned?: number
          ended_at?: string | null
          errors?: Json
          id?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      legal_jurisprudencia: {
        Row: {
          binding: boolean
          body: string
          created_at: string
          epoca: string | null
          formation_method: string | null
          id: string
          issuing_body: string | null
          published_at: string | null
          registry_number: string | null
          source_url: string | null
          title: string
          updated_at: string
          verification_status: Database["public"]["Enums"]["legal_verification_status"]
        }
        Insert: {
          binding?: boolean
          body: string
          created_at?: string
          epoca?: string | null
          formation_method?: string | null
          id?: string
          issuing_body?: string | null
          published_at?: string | null
          registry_number?: string | null
          source_url?: string | null
          title: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
        }
        Update: {
          binding?: boolean
          body?: string
          created_at?: string
          epoca?: string | null
          formation_method?: string | null
          id?: string
          issuing_body?: string | null
          published_at?: string | null
          registry_number?: string | null
          source_url?: string | null
          title?: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
        }
        Relationships: []
      }
      legal_keyword_links: {
        Row: {
          entity_id: string
          entity_type: string
          id: string
          keyword_id: string
        }
        Insert: {
          entity_id: string
          entity_type: string
          id?: string
          keyword_id: string
        }
        Update: {
          entity_id?: string
          entity_type?: string
          id?: string
          keyword_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_keyword_links_keyword_id_fkey"
            columns: ["keyword_id"]
            isOneToOne: false
            referencedRelation: "legal_keywords"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_keywords: {
        Row: {
          created_at: string
          id: string
          term: string
        }
        Insert: {
          created_at?: string
          id?: string
          term: string
        }
        Update: {
          created_at?: string
          id?: string
          term?: string
        }
        Relationships: []
      }
      legal_precedents: {
        Row: {
          authority_id: string | null
          binding: boolean
          case_number: string | null
          court: string
          created_at: string
          decision_date: string | null
          full_text: string | null
          id: string
          jurisdiction: string | null
          source_url: string | null
          summary: string | null
          updated_at: string
          verification_status: Database["public"]["Enums"]["legal_verification_status"]
        }
        Insert: {
          authority_id?: string | null
          binding?: boolean
          case_number?: string | null
          court: string
          created_at?: string
          decision_date?: string | null
          full_text?: string | null
          id?: string
          jurisdiction?: string | null
          source_url?: string | null
          summary?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
        }
        Update: {
          authority_id?: string | null
          binding?: boolean
          case_number?: string | null
          court?: string
          created_at?: string
          decision_date?: string | null
          full_text?: string | null
          id?: string
          jurisdiction?: string | null
          source_url?: string | null
          summary?: string | null
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "legal_precedents_authority_id_fkey"
            columns: ["authority_id"]
            isOneToOne: false
            referencedRelation: "legal_authorities"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_profiles: {
        Row: {
          code: string
          country: string
          created_at: string
          id: string
          jurisdictions: Json
          language: string
          legal_system: string
          metadata: Json
          name: string
          practice_areas: Json
          primary_sources: Json
          prompt_lock: string | null
          updated_at: string
        }
        Insert: {
          code: string
          country: string
          created_at?: string
          id?: string
          jurisdictions?: Json
          language?: string
          legal_system: string
          metadata?: Json
          name: string
          practice_areas?: Json
          primary_sources?: Json
          prompt_lock?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          country?: string
          created_at?: string
          id?: string
          jurisdictions?: Json
          language?: string
          legal_system?: string
          metadata?: Json
          name?: string
          practice_areas?: Json
          primary_sources?: Json
          prompt_lock?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      legal_regulations: {
        Row: {
          body: string | null
          created_at: string
          effective_at: string | null
          id: string
          implements_authority_id: string | null
          issuer: string | null
          jurisdiction: string | null
          published_at: string | null
          source_url: string | null
          title: string
          updated_at: string
          verification_status: Database["public"]["Enums"]["legal_verification_status"]
        }
        Insert: {
          body?: string | null
          created_at?: string
          effective_at?: string | null
          id?: string
          implements_authority_id?: string | null
          issuer?: string | null
          jurisdiction?: string | null
          published_at?: string | null
          source_url?: string | null
          title: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
        }
        Update: {
          body?: string | null
          created_at?: string
          effective_at?: string | null
          id?: string
          implements_authority_id?: string | null
          issuer?: string | null
          jurisdiction?: string | null
          published_at?: string | null
          source_url?: string | null
          title?: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "legal_regulations_implements_authority_id_fkey"
            columns: ["implements_authority_id"]
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
      legal_theses: {
        Row: {
          body: string
          created_at: string
          epoca: string | null
          id: string
          issuing_body: string | null
          published_at: string | null
          registry_number: string | null
          source_url: string | null
          title: string
          updated_at: string
          verification_status: Database["public"]["Enums"]["legal_verification_status"]
        }
        Insert: {
          body: string
          created_at?: string
          epoca?: string | null
          id?: string
          issuing_body?: string | null
          published_at?: string | null
          registry_number?: string | null
          source_url?: string | null
          title: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
        }
        Update: {
          body?: string
          created_at?: string
          epoca?: string | null
          id?: string
          issuing_body?: string | null
          published_at?: string | null
          registry_number?: string | null
          source_url?: string | null
          title?: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["legal_verification_status"]
        }
        Relationships: []
      }
      legal_topic_links: {
        Row: {
          entity_id: string
          entity_type: string
          id: string
          topic_id: string
        }
        Insert: {
          entity_id: string
          entity_type: string
          id?: string
          topic_id: string
        }
        Update: {
          entity_id?: string
          entity_type?: string
          id?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_topic_links_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "legal_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_topics: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_topic_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_topic_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_topic_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_topics_parent_topic_id_fkey"
            columns: ["parent_topic_id"]
            isOneToOne: false
            referencedRelation: "legal_topics"
            referencedColumns: ["id"]
          },
        ]
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
          legal_profile_code: string
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
          legal_profile_code?: string
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
          legal_profile_code?: string
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
      pipeline_engine_runs: {
        Row: {
          accepted: number
          blocking_engines: string[] | null
          case_id: string
          cost_usd: number
          created_at: string
          db_write_confirmed: boolean | null
          dependency_status: string | null
          ended_at: string | null
          engine: string
          error: string | null
          generated: number
          id: string
          meta: Json
          model: string | null
          parent_engine: string | null
          prompt_version: string | null
          provider: string | null
          rejected: number
          retry_count: number
          rows_written: number | null
          runtime_ms: number | null
          skipped_reason: string | null
          started_at: string | null
          status: string
          suppressed_ess: number
          suppressed_validator: number
          tokens_in: number
          tokens_out: number
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted?: number
          blocking_engines?: string[] | null
          case_id: string
          cost_usd?: number
          created_at?: string
          db_write_confirmed?: boolean | null
          dependency_status?: string | null
          ended_at?: string | null
          engine: string
          error?: string | null
          generated?: number
          id?: string
          meta?: Json
          model?: string | null
          parent_engine?: string | null
          prompt_version?: string | null
          provider?: string | null
          rejected?: number
          retry_count?: number
          rows_written?: number | null
          runtime_ms?: number | null
          skipped_reason?: string | null
          started_at?: string | null
          status: string
          suppressed_ess?: number
          suppressed_validator?: number
          tokens_in?: number
          tokens_out?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted?: number
          blocking_engines?: string[] | null
          case_id?: string
          cost_usd?: number
          created_at?: string
          db_write_confirmed?: boolean | null
          dependency_status?: string | null
          ended_at?: string | null
          engine?: string
          error?: string | null
          generated?: number
          id?: string
          meta?: Json
          model?: string | null
          parent_engine?: string | null
          prompt_version?: string | null
          provider?: string | null
          rejected?: number
          retry_count?: number
          rows_written?: number | null
          runtime_ms?: number | null
          skipped_reason?: string | null
          started_at?: string | null
          status?: string
          suppressed_ess?: number
          suppressed_validator?: number
          tokens_in?: number
          tokens_out?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_engine_runs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_events: {
        Row: {
          case_id: string
          created_at: string
          id: string
          level: string
          message: string
          meta: Json
          stage: string
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          level?: string
          message: string
          meta?: Json
          stage: string
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          level?: string
          message?: string
          meta?: Json
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_trace: {
        Row: {
          attempt: number | null
          case_id: string
          correlation_id: string | null
          created_at: string
          detail: Json
          duration_ms: number | null
          error: string | null
          id: number
          level: string
          model: string | null
          phase: string
          provider: string | null
          status: string
          step: string
          user_id: string | null
        }
        Insert: {
          attempt?: number | null
          case_id: string
          correlation_id?: string | null
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          error?: string | null
          id?: number
          level?: string
          model?: string | null
          phase: string
          provider?: string | null
          status?: string
          step: string
          user_id?: string | null
        }
        Update: {
          attempt?: number | null
          case_id?: string
          correlation_id?: string | null
          created_at?: string
          detail?: Json
          duration_ms?: number | null
          error?: string | null
          id?: number
          level?: string
          model?: string | null
          phase?: string
          provider?: string | null
          status?: string
          step?: string
          user_id?: string | null
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
          email: string | null
          full_name: string | null
          id: string
          is_blocked: boolean
          locale: string
          preferred_language: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          default_org_id?: string | null
          deleted_at?: string | null
          display_name?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_blocked?: boolean
          locale?: string
          preferred_language?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          default_org_id?: string | null
          deleted_at?: string | null
          display_name?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_blocked?: boolean
          locale?: string
          preferred_language?: string
          updated_at?: string
        }
        Relationships: []
      }
      property_records: {
        Row: {
          address: string | null
          buyer_name: string | null
          case_id: string
          catastro_id: string | null
          closing_date: string | null
          country: string
          created_at: string
          cuenta_predial: string | null
          fideicomiso: boolean
          folio_real: string | null
          foreign_buyer: boolean
          municipality: string | null
          notary: string | null
          property_type: string | null
          purchase_price: number | null
          seller_name: string | null
          state: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          buyer_name?: string | null
          case_id: string
          catastro_id?: string | null
          closing_date?: string | null
          country?: string
          created_at?: string
          cuenta_predial?: string | null
          fideicomiso?: boolean
          folio_real?: string | null
          foreign_buyer?: boolean
          municipality?: string | null
          notary?: string | null
          property_type?: string | null
          purchase_price?: number | null
          seller_name?: string | null
          state?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          buyer_name?: string | null
          case_id?: string
          catastro_id?: string | null
          closing_date?: string | null
          country?: string
          created_at?: string
          cuenta_predial?: string | null
          fideicomiso?: boolean
          folio_real?: string | null
          foreign_buyer?: boolean
          municipality?: string | null
          notary?: string | null
          property_type?: string | null
          purchase_price?: number | null
          seller_name?: string | null
          state?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_records_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      report_versions: {
        Row: {
          canonical_version: number | null
          case_id: string
          change_log: Json | null
          contradiction_count: number | null
          created_at: string
          document_count: number | null
          ess: number | null
          findings_count: number | null
          id: string
          score: number | null
          snapshot: Json
          user_id: string | null
          version: number
        }
        Insert: {
          canonical_version?: number | null
          case_id: string
          change_log?: Json | null
          contradiction_count?: number | null
          created_at?: string
          document_count?: number | null
          ess?: number | null
          findings_count?: number | null
          id?: string
          score?: number | null
          snapshot: Json
          user_id?: string | null
          version: number
        }
        Update: {
          canonical_version?: number | null
          case_id?: string
          change_log?: Json | null
          contradiction_count?: number | null
          created_at?: string
          document_count?: number | null
          ess?: number | null
          findings_count?: number | null
          id?: string
          score?: number | null
          snapshot?: Json
          user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_versions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          alternative_theory_report: string | null
          appendix_sources: string | null
          attorney_summary: string | null
          canonical_version: number | null
          case_id: string
          case_overview: string | null
          case_strength_score: number | null
          change_log: Json | null
          citations: Json
          constitutional_issues: string | null
          constitutional_issues_struct: Json
          contradiction_report: string | null
          contradictions_struct: Json | null
          created_at: string
          cross_examination: Json
          defense_theory_report: string | null
          discovery_analysis: string | null
          engines_summary: Json | null
          evidence_index: Json
          evidence_summary: string | null
          executive_summary: string | null
          facts: string | null
          findings_count: number | null
          full_report: Json
          generated_language: string
          id: string
          intelligence_version: string | null
          investigator_summary: string | null
          item_flags: Json
          missing_evidence_report: Json | null
          missing_evidence_struct: Json | null
          motion_opportunities: Json
          motions_suppressed: boolean
          next_actions: Json
          procedural_issues_report: string | null
          prosecution_theory_report: string | null
          quality_block_reasons: Json | null
          quality_blocked: boolean
          recommendations: string | null
          report_chunk_cache: Json
          report_mode: string | null
          risk_analysis: string | null
          risk_score: number | null
          score_breakdown: string | null
          scores_suppressed: boolean
          strategy_recommendations: Json
          timeline_summary: string | null
          updated_at: string
          user_id: string | null
          version: number
          witness_analysis: string | null
        }
        Insert: {
          alternative_theory_report?: string | null
          appendix_sources?: string | null
          attorney_summary?: string | null
          canonical_version?: number | null
          case_id: string
          case_overview?: string | null
          case_strength_score?: number | null
          change_log?: Json | null
          citations?: Json
          constitutional_issues?: string | null
          constitutional_issues_struct?: Json
          contradiction_report?: string | null
          contradictions_struct?: Json | null
          created_at?: string
          cross_examination?: Json
          defense_theory_report?: string | null
          discovery_analysis?: string | null
          engines_summary?: Json | null
          evidence_index?: Json
          evidence_summary?: string | null
          executive_summary?: string | null
          facts?: string | null
          findings_count?: number | null
          full_report?: Json
          generated_language?: string
          id?: string
          intelligence_version?: string | null
          investigator_summary?: string | null
          item_flags?: Json
          missing_evidence_report?: Json | null
          missing_evidence_struct?: Json | null
          motion_opportunities?: Json
          motions_suppressed?: boolean
          next_actions?: Json
          procedural_issues_report?: string | null
          prosecution_theory_report?: string | null
          quality_block_reasons?: Json | null
          quality_blocked?: boolean
          recommendations?: string | null
          report_chunk_cache?: Json
          report_mode?: string | null
          risk_analysis?: string | null
          risk_score?: number | null
          score_breakdown?: string | null
          scores_suppressed?: boolean
          strategy_recommendations?: Json
          timeline_summary?: string | null
          updated_at?: string
          user_id?: string | null
          version?: number
          witness_analysis?: string | null
        }
        Update: {
          alternative_theory_report?: string | null
          appendix_sources?: string | null
          attorney_summary?: string | null
          canonical_version?: number | null
          case_id?: string
          case_overview?: string | null
          case_strength_score?: number | null
          change_log?: Json | null
          citations?: Json
          constitutional_issues?: string | null
          constitutional_issues_struct?: Json
          contradiction_report?: string | null
          contradictions_struct?: Json | null
          created_at?: string
          cross_examination?: Json
          defense_theory_report?: string | null
          discovery_analysis?: string | null
          engines_summary?: Json | null
          evidence_index?: Json
          evidence_summary?: string | null
          executive_summary?: string | null
          facts?: string | null
          findings_count?: number | null
          full_report?: Json
          generated_language?: string
          id?: string
          intelligence_version?: string | null
          investigator_summary?: string | null
          item_flags?: Json
          missing_evidence_report?: Json | null
          missing_evidence_struct?: Json | null
          motion_opportunities?: Json
          motions_suppressed?: boolean
          next_actions?: Json
          procedural_issues_report?: string | null
          prosecution_theory_report?: string | null
          quality_block_reasons?: Json | null
          quality_blocked?: boolean
          recommendations?: string | null
          report_chunk_cache?: Json
          report_mode?: string | null
          risk_analysis?: string | null
          risk_score?: number | null
          score_breakdown?: string | null
          scores_suppressed?: boolean
          strategy_recommendations?: Json
          timeline_summary?: string | null
          updated_at?: string
          user_id?: string | null
          version?: number
          witness_analysis?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
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
      subscriptions: {
        Row: {
          beta_granted_at: string | null
          beta_granted_by: string | null
          beta_note: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          free_case_case_id: string | null
          free_case_used: boolean
          is_beta_tester: boolean
          plan: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          beta_granted_at?: string | null
          beta_granted_by?: string | null
          beta_note?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          free_case_case_id?: string | null
          free_case_used?: boolean
          is_beta_tester?: boolean
          plan?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          beta_granted_at?: string | null
          beta_granted_by?: string | null
          beta_note?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          free_case_case_id?: string | null
          free_case_used?: boolean
          is_beta_tester?: boolean
          plan?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_free_case_case_id_fkey"
            columns: ["free_case_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ai_keys: {
        Row: {
          calls_month: number
          calls_today: number
          created_at: string
          encrypted_key: string
          id: string
          is_active: boolean
          key_fingerprint: string
          label: string | null
          last_test_error: string | null
          last_test_latency_ms: number | null
          last_test_ok: boolean | null
          last_used_at: string | null
          priority: number | null
          provider: Database["public"]["Enums"]["ai_provider"]
          tokens_month: number
          tokens_today: number
          updated_at: string
          usage_date: string | null
          usage_month: string | null
          user_id: string
        }
        Insert: {
          calls_month?: number
          calls_today?: number
          created_at?: string
          encrypted_key: string
          id?: string
          is_active?: boolean
          key_fingerprint: string
          label?: string | null
          last_test_error?: string | null
          last_test_latency_ms?: number | null
          last_test_ok?: boolean | null
          last_used_at?: string | null
          priority?: number | null
          provider: Database["public"]["Enums"]["ai_provider"]
          tokens_month?: number
          tokens_today?: number
          updated_at?: string
          usage_date?: string | null
          usage_month?: string | null
          user_id: string
        }
        Update: {
          calls_month?: number
          calls_today?: number
          created_at?: string
          encrypted_key?: string
          id?: string
          is_active?: boolean
          key_fingerprint?: string
          label?: string | null
          last_test_error?: string | null
          last_test_latency_ms?: number | null
          last_test_ok?: boolean | null
          last_used_at?: string | null
          priority?: number | null
          provider?: Database["public"]["Enums"]["ai_provider"]
          tokens_month?: number
          tokens_today?: number
          updated_at?: string
          usage_date?: string | null
          usage_month?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_groq_keys: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key_value: string
          label: string
          last_error: string | null
          last_error_at: string | null
          last_used_at: string | null
          priority: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_value: string
          label?: string
          last_error?: string | null
          last_error_at?: string | null
          last_used_at?: string | null
          priority?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_value?: string
          label?: string
          last_error?: string | null
          last_error_at?: string | null
          last_used_at?: string | null
          priority?: number | null
          user_id?: string
        }
        Relationships: []
      }
      user_intelligence_features: {
        Row: {
          created_at: string
          feature_key: string
          id: string
          mode: string
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          feature_key: string
          id?: string
          mode?: string
          provider?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          feature_key?: string
          id?: string
          mode?: string
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_provider_order: {
        Row: {
          created_at: string
          id: string
          order_index: number
          provider: Database["public"]["Enums"]["ai_provider"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_index: number
          provider: Database["public"]["Enums"]["ai_provider"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_index?: number
          provider?: Database["public"]["Enums"]["ai_provider"]
          updated_at?: string
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
      user_settings: {
        Row: {
          ai_default_mode: string
          ai_max_response_chars: number
          ai_response_style: string
          avatar_url: string | null
          created_at: string
          display_name: string | null
          firm_id: string | null
          firm_name: string | null
          gemini_api_key: string | null
          notify_email: boolean
          notify_new_evidence: boolean
          notify_pipeline_complete: boolean
          notify_pipeline_failed: boolean
          phone: string | null
          title: string | null
          updated_at: string
          user_id: string
          voice_accent: string
          voice_autoplay: boolean
          voice_continuous: boolean
          voice_gender: string
          voice_id: string
          voice_muted: boolean
          voice_pitch: string
          voice_speed: number
        }
        Insert: {
          ai_default_mode?: string
          ai_max_response_chars?: number
          ai_response_style?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          firm_id?: string | null
          firm_name?: string | null
          gemini_api_key?: string | null
          notify_email?: boolean
          notify_new_evidence?: boolean
          notify_pipeline_complete?: boolean
          notify_pipeline_failed?: boolean
          phone?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          voice_accent?: string
          voice_autoplay?: boolean
          voice_continuous?: boolean
          voice_gender?: string
          voice_id?: string
          voice_muted?: boolean
          voice_pitch?: string
          voice_speed?: number
        }
        Update: {
          ai_default_mode?: string
          ai_max_response_chars?: number
          ai_response_style?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          firm_id?: string | null
          firm_name?: string | null
          gemini_api_key?: string | null
          notify_email?: boolean
          notify_new_evidence?: boolean
          notify_pipeline_complete?: boolean
          notify_pipeline_failed?: boolean
          phone?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          voice_accent?: string
          voice_autoplay?: boolean
          voice_continuous?: boolean
          voice_gender?: string
          voice_id?: string
          voice_muted?: boolean
          voice_pitch?: string
          voice_speed?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_items: {
        Row: {
          case_id: string
          category: Database["public"]["Enums"]["verification_category"]
          created_at: string
          evidence_document_id: string | null
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["verification_status"]
          updated_at: string
          user_id: string
          verification_mode: Database["public"]["Enums"]["verification_mode"]
        }
        Insert: {
          case_id: string
          category: Database["public"]["Enums"]["verification_category"]
          created_at?: string
          evidence_document_id?: string | null
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
          updated_at?: string
          user_id: string
          verification_mode?: Database["public"]["Enums"]["verification_mode"]
        }
        Update: {
          case_id?: string
          category?: Database["public"]["Enums"]["verification_category"]
          created_at?: string
          evidence_document_id?: string | null
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
          updated_at?: string
          user_id?: string
          verification_mode?: Database["public"]["Enums"]["verification_mode"]
        }
        Relationships: [
          {
            foreignKeyName: "verification_items_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_items_evidence_document_id_fkey"
            columns: ["evidence_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          detail: string | null
          event_type: string
          id: string
          status: string
          stripe_event_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: string | null
          event_type: string
          id?: string
          status: string
          stripe_event_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: string | null
          event_type?: string
          id?: string
          status?: string
          stripe_event_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      worker_secrets: {
        Row: {
          created_at: string
          name: string
          secret: string
        }
        Insert: {
          created_at?: string
          name: string
          secret: string
        }
        Update: {
          created_at?: string
          name?: string
          secret?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_factory_reset_case_data: {
        Args: {
          p_actor_id?: string
          p_include_ai_usage?: boolean
          p_include_audit?: boolean
          p_include_demo?: boolean
        }
        Returns: Json
      }
      admin_get_user_id_by_email: { Args: { _email: string }; Returns: string }
      admin_list_firms_with_seats: {
        Args: never
        Returns: {
          domain: string
          firm_id: string
          name: string
          owner_user_id: string
          plan_key: string
          seat_limit: number
          seats_used: number
        }[]
      }
      admin_list_pending_beta_invites: {
        Args: never
        Returns: {
          email: string
          invited_at: string
          note: string
        }[]
      }
      admin_list_users_with_subscriptions: {
        Args: never
        Returns: {
          beta_granted_at: string
          beta_note: string
          current_period_end: string
          email: string
          free_case_used: boolean
          is_beta_tester: boolean
          plan: string
          status: string
          stripe_customer_id: string
          user_created_at: string
          user_id: string
        }[]
      }
      can_contribute_org: {
        Args: { _org: string; _user: string }
        Returns: boolean
      }
      can_manage_org: {
        Args: { _org: string; _user: string }
        Returns: boolean
      }
      closing_readiness: { Args: { p_case_id: string }; Returns: number }
      firm_seat_usage: {
        Args: { _firm_id: string }
        Returns: {
          plan_key: string
          seat_limit: number
          seats_used: number
        }[]
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
      is_admin_tier: { Args: { _user_id: string }; Returns: boolean }
      is_case_manager: { Args: { _user_id: string }; Returns: boolean }
      is_member_of_firm: {
        Args: { _firm: string; _user: string }
        Returns: boolean
      }
      is_org_member: { Args: { _org: string; _user: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      org_role_of: {
        Args: { _org: string; _user: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
      plan_seat_limit: { Args: { _plan: string }; Returns: number }
      project_case_findings: {
        Args: { p_case_id: string; p_rows: Json }
        Returns: number
      }
      resolve_firm_for_email: { Args: { _email: string }; Returns: string }
      same_firm: { Args: { _a: string; _b: string }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      ai_provider: "groq" | "openai" | "gemini" | "anthropic" | "openrouter"
      app_role:
        | "admin"
        | "moderator"
        | "user"
        | "super_admin"
        | "platform_admin"
        | "firm_admin"
        | "case_manager"
      canonical_status: "orchestrating" | "completed" | "failed" | "validated"
      case_status:
        | "uploaded"
        | "extracting"
        | "analyzing"
        | "scoring"
        | "reporting"
        | "complete"
        | "failed"
        | "intelligence_running"
        | "intelligence_complete"
        | "cancelled"
        | "queued"
        | "released"
        | "needs_revision"
        | "stalled"
        | "extracted"
        | "analyzed"
        | "agents_running"
        | "agents_complete"
        | "scored"
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
      doc_status:
        | "pending"
        | "extracting"
        | "extracted"
        | "failed"
        | "skipped_duplicate"
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
      legal_verification_status:
        | "verified"
        | "pending"
        | "deprecated"
        | "superseded"
        | "failed_verification"
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
      verification_category:
        | "ownership"
        | "registry"
        | "catastro"
        | "predial"
        | "water"
        | "cfe"
        | "hoa"
        | "mortgage"
        | "permits"
        | "corporate_authority"
        | "environmental"
      verification_mode: "connected" | "document" | "manual"
      verification_status: "verified" | "pending" | "missing" | "issue_found"
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
      ai_provider: ["groq", "openai", "gemini", "anthropic", "openrouter"],
      app_role: [
        "admin",
        "moderator",
        "user",
        "super_admin",
        "platform_admin",
        "firm_admin",
        "case_manager",
      ],
      canonical_status: ["orchestrating", "completed", "failed", "validated"],
      case_status: [
        "uploaded",
        "extracting",
        "analyzing",
        "scoring",
        "reporting",
        "complete",
        "failed",
        "intelligence_running",
        "intelligence_complete",
        "cancelled",
        "queued",
        "released",
        "needs_revision",
        "stalled",
        "extracted",
        "analyzed",
        "agents_running",
        "agents_complete",
        "scored",
      ],
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
      doc_status: [
        "pending",
        "extracting",
        "extracted",
        "failed",
        "skipped_duplicate",
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
      legal_verification_status: [
        "verified",
        "pending",
        "deprecated",
        "superseded",
        "failed_verification",
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
      verification_category: [
        "ownership",
        "registry",
        "catastro",
        "predial",
        "water",
        "cfe",
        "hoa",
        "mortgage",
        "permits",
        "corporate_authority",
        "environmental",
      ],
      verification_mode: ["connected", "document", "manual"],
      verification_status: ["verified", "pending", "missing", "issue_found"],
    },
  },
} as const
