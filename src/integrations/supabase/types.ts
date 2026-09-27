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
      ai_chat_messages: {
        Row: {
          content: string
          created_at: string
          created_incident_id: string | null
          id: string
          organization_id: string
          role: string
          suggested_ticket: Json | null
          thread_id: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          created_incident_id?: string | null
          id?: string
          organization_id: string
          role: string
          suggested_ticket?: Json | null
          thread_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          created_incident_id?: string | null
          id?: string
          organization_id?: string
          role?: string
          suggested_ticket?: Json | null
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_created_incident_id_fkey"
            columns: ["created_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chat_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_threads: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_threads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          approver_id: string
          created_at: string
          decided_at: string | null
          decision_notes: string | null
          id: string
          organization_id: string
          record_id: string
          record_type: string
          status: string
          updated_at: string
        }
        Insert: {
          approver_id: string
          created_at?: string
          decided_at?: string | null
          decision_notes?: string | null
          id?: string
          organization_id: string
          record_id: string
          record_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          approver_id?: string
          created_at?: string
          decided_at?: string | null
          decision_notes?: string | null
          id?: string
          organization_id?: string
          record_id?: string
          record_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string | null
          organization_id: string
          record_id: string
          record_type: string
          size_bytes: number | null
          storage_path: string
          uploader_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type?: string | null
          organization_id: string
          record_id: string
          record_type: string
          size_bytes?: number | null
          storage_path: string
          uploader_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          organization_id?: string
          record_id?: string
          record_type?: string
          size_bytes?: number | null
          storage_path?: string
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          after_values: Json | null
          before_values: Json | null
          correlation_id: string
          created_at: string
          id: string
          organization_id: string
          record_id: string | null
          record_type: string
          source: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_values?: Json | null
          before_values?: Json | null
          correlation_id?: string
          created_at?: string
          id?: string
          organization_id: string
          record_id?: string | null
          record_type: string
          source?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_values?: Json | null
          before_values?: Json | null
          correlation_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          record_id?: string | null
          record_type?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_items: {
        Row: {
          active: boolean
          approval_required: boolean
          category: string
          created_at: string
          delivery_days: number
          description: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          approval_required?: boolean
          category: string
          created_at?: string
          delivery_days?: number
          description?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          approval_required?: boolean
          category?: string
          created_at?: string
          delivery_days?: number
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      changes: {
        Row: {
          actual_end_at: string | null
          actual_start_at: string | null
          affected_ci_ids: string[]
          approval_status: string
          business_justification: string | null
          change_type: string
          closed_at: string | null
          communication_plan: string | null
          created_at: string
          delivered_at: string | null
          delivery_outcome: string | null
          description: string
          end_at: string | null
          expected_outage_minutes: number
          id: string
          impact_assessment: string | null
          implementation_plan: string | null
          number: string
          organization_id: string
          owner_id: string | null
          pir_notes: string | null
          requester_id: string
          risk: string
          rollback_plan: string | null
          rollback_trigger: string | null
          rollback_used: boolean
          service_id: string | null
          start_at: string | null
          state: Database["public"]["Enums"]["record_state"]
          test_plan: string | null
          title: string
          updated_at: string
          validation_plan: string | null
          validation_results: string | null
        }
        Insert: {
          actual_end_at?: string | null
          actual_start_at?: string | null
          affected_ci_ids?: string[]
          approval_status?: string
          business_justification?: string | null
          change_type: string
          closed_at?: string | null
          communication_plan?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_outcome?: string | null
          description?: string
          end_at?: string | null
          expected_outage_minutes?: number
          id?: string
          impact_assessment?: string | null
          implementation_plan?: string | null
          number: string
          organization_id: string
          owner_id?: string | null
          pir_notes?: string | null
          requester_id: string
          risk?: string
          rollback_plan?: string | null
          rollback_trigger?: string | null
          rollback_used?: boolean
          service_id?: string | null
          start_at?: string | null
          state?: Database["public"]["Enums"]["record_state"]
          test_plan?: string | null
          title: string
          updated_at?: string
          validation_plan?: string | null
          validation_results?: string | null
        }
        Update: {
          actual_end_at?: string | null
          actual_start_at?: string | null
          affected_ci_ids?: string[]
          approval_status?: string
          business_justification?: string | null
          change_type?: string
          closed_at?: string | null
          communication_plan?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_outcome?: string | null
          description?: string
          end_at?: string | null
          expected_outage_minutes?: number
          id?: string
          impact_assessment?: string | null
          implementation_plan?: string | null
          number?: string
          organization_id?: string
          owner_id?: string | null
          pir_notes?: string | null
          requester_id?: string
          risk?: string
          rollback_plan?: string | null
          rollback_trigger?: string | null
          rollback_used?: boolean
          service_id?: string | null
          start_at?: string | null
          state?: Database["public"]["Enums"]["record_state"]
          test_plan?: string | null
          title?: string
          updated_at?: string
          validation_plan?: string | null
          validation_results?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "changes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "changes_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      ci_relationships: {
        Row: {
          child_id: string
          created_at: string
          id: string
          organization_id: string
          parent_id: string
          relationship_type: string
        }
        Insert: {
          child_id: string
          created_at?: string
          id?: string
          organization_id: string
          parent_id: string
          relationship_type: string
        }
        Update: {
          child_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          parent_id?: string
          relationship_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ci_relationships_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "configuration_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ci_relationships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ci_relationships_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "configuration_items"
            referencedColumns: ["id"]
          },
        ]
      }
      configuration_items: {
        Row: {
          asset_tag: string | null
          ci_class: string
          created_at: string
          criticality: string
          environment: string | null
          id: string
          ip_address: unknown
          last_discovered_at: string | null
          location: string | null
          metadata: Json
          name: string
          organization_id: string
          owner_id: string | null
          service_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          asset_tag?: string | null
          ci_class: string
          created_at?: string
          criticality?: string
          environment?: string | null
          id?: string
          ip_address?: unknown
          last_discovered_at?: string | null
          location?: string | null
          metadata?: Json
          name: string
          organization_id: string
          owner_id?: string | null
          service_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          asset_tag?: string | null
          ci_class?: string
          created_at?: string
          criticality?: string
          environment?: string | null
          id?: string
          ip_address?: unknown
          last_discovered_at?: string | null
          location?: string | null
          metadata?: Json
          name?: string
          organization_id?: string
          owner_id?: string | null
          service_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "configuration_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "configuration_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          assignee_id: string | null
          category: string | null
          close_code: string | null
          contact_type: string | null
          created_at: string
          description: string
          first_responded_at: string | null
          group_id: string | null
          id: string
          impact: number
          major_incident: boolean
          number: string
          on_hold_reason: string | null
          organization_id: string
          priority: number | null
          problem_id: string | null
          reopen_count: number
          requester_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          service_id: string | null
          sla_due_at: string | null
          state: Database["public"]["Enums"]["record_state"]
          subcategory: string | null
          title: string
          updated_at: string
          urgency: number
        }
        Insert: {
          assignee_id?: string | null
          category?: string | null
          close_code?: string | null
          contact_type?: string | null
          created_at?: string
          description?: string
          first_responded_at?: string | null
          group_id?: string | null
          id?: string
          impact?: number
          major_incident?: boolean
          number: string
          on_hold_reason?: string | null
          organization_id: string
          priority?: number | null
          problem_id?: string | null
          reopen_count?: number
          requester_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          service_id?: string | null
          sla_due_at?: string | null
          state?: Database["public"]["Enums"]["record_state"]
          subcategory?: string | null
          title: string
          updated_at?: string
          urgency?: number
        }
        Update: {
          assignee_id?: string | null
          category?: string | null
          close_code?: string | null
          contact_type?: string | null
          created_at?: string
          description?: string
          first_responded_at?: string | null
          group_id?: string | null
          id?: string
          impact?: number
          major_incident?: boolean
          number?: string
          on_hold_reason?: string | null
          organization_id?: string
          priority?: number | null
          problem_id?: string | null
          reopen_count?: number
          requester_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          service_id?: string | null
          sla_due_at?: string | null
          state?: Database["public"]["Enums"]["record_state"]
          subcategory?: string | null
          title?: string
          updated_at?: string
          urgency?: number
        }
        Relationships: [
          {
            foreignKeyName: "incidents_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_articles: {
        Row: {
          author_id: string | null
          category: string
          content: string
          created_at: string
          expires_at: string | null
          helpful_count: number
          id: string
          number: string
          organization_id: string
          published_at: string | null
          reviewer_id: string | null
          status: string
          summary: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          author_id?: string | null
          category?: string
          content?: string
          created_at?: string
          expires_at?: string | null
          helpful_count?: number
          id?: string
          number: string
          organization_id: string
          published_at?: string | null
          reviewer_id?: string | null
          status?: string
          summary?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          author_id?: string | null
          category?: string
          content?: string
          created_at?: string
          expires_at?: string | null
          helpful_count?: number
          id?: string
          number?: string
          organization_id?: string
          published_at?: string | null
          reviewer_id?: string | null
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_articles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      major_incident_updates: {
        Row: {
          audience: string
          author_id: string | null
          body: string
          created_at: string
          id: string
          major_incident_id: string
          organization_id: string
          update_type: string
        }
        Insert: {
          audience?: string
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          major_incident_id: string
          organization_id: string
          update_type?: string
        }
        Update: {
          audience?: string
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          major_incident_id?: string
          organization_id?: string
          update_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "major_incident_updates_major_incident_id_fkey"
            columns: ["major_incident_id"]
            isOneToOne: false
            referencedRelation: "major_incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "major_incident_updates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      major_incidents: {
        Row: {
          bridge_state: string
          bridge_url: string | null
          commander_id: string | null
          comms_lead_id: string | null
          created_at: string
          customer_impact: string | null
          declared_at: string
          declared_by: string | null
          escalation_level: number
          id: string
          incident_id: string
          mitigated_at: string | null
          next_update_at: string | null
          number: string
          organization_id: string
          problem_id: string | null
          resolved_at: string | null
          severity: number
          situation_summary: string | null
          updated_at: string
        }
        Insert: {
          bridge_state?: string
          bridge_url?: string | null
          commander_id?: string | null
          comms_lead_id?: string | null
          created_at?: string
          customer_impact?: string | null
          declared_at?: string
          declared_by?: string | null
          escalation_level?: number
          id?: string
          incident_id: string
          mitigated_at?: string | null
          next_update_at?: string | null
          number: string
          organization_id: string
          problem_id?: string | null
          resolved_at?: string | null
          severity?: number
          situation_summary?: string | null
          updated_at?: string
        }
        Update: {
          bridge_state?: string
          bridge_url?: string | null
          commander_id?: string | null
          comms_lead_id?: string | null
          created_at?: string
          customer_impact?: string | null
          declared_at?: string
          declared_by?: string | null
          escalation_level?: number
          id?: string
          incident_id?: string
          mitigated_at?: string | null
          next_update_at?: string | null
          number?: string
          organization_id?: string
          problem_id?: string | null
          resolved_at?: string | null
          severity?: number
          situation_summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "major_incidents_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: true
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "major_incidents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "major_incidents_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          organization_id: string
          read_at: string | null
          record_id: string | null
          record_type: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          organization_id: string
          read_at?: string | null
          record_id?: string | null
          record_type?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          read_at?: string | null
          record_id?: string | null
          record_type?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      problem_incidents: {
        Row: {
          created_at: string
          id: string
          incident_id: string
          linked_by: string | null
          organization_id: string
          problem_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          incident_id: string
          linked_by?: string | null
          organization_id: string
          problem_id: string
        }
        Update: {
          created_at?: string
          id?: string
          incident_id?: string
          linked_by?: string | null
          organization_id?: string
          problem_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_incidents_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_incidents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_incidents_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
        ]
      }
      problems: {
        Row: {
          assignee_id: string | null
          category: string | null
          created_at: string
          description: string
          fix_plan: string | null
          id: string
          impact: number
          knowledge_article_id: string | null
          known_error: boolean
          number: string
          opened_by: string | null
          organization_id: string
          priority: number | null
          resolution_notes: string | null
          resolved_at: string | null
          root_cause: string | null
          service_id: string | null
          state: Database["public"]["Enums"]["record_state"]
          title: string
          updated_at: string
          urgency: number
          workaround: string | null
        }
        Insert: {
          assignee_id?: string | null
          category?: string | null
          created_at?: string
          description: string
          fix_plan?: string | null
          id?: string
          impact?: number
          knowledge_article_id?: string | null
          known_error?: boolean
          number: string
          opened_by?: string | null
          organization_id: string
          priority?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          root_cause?: string | null
          service_id?: string | null
          state?: Database["public"]["Enums"]["record_state"]
          title: string
          updated_at?: string
          urgency?: number
          workaround?: string | null
        }
        Update: {
          assignee_id?: string | null
          category?: string | null
          created_at?: string
          description?: string
          fix_plan?: string | null
          id?: string
          impact?: number
          knowledge_article_id?: string | null
          known_error?: boolean
          number?: string
          opened_by?: string | null
          organization_id?: string
          priority?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          root_cause?: string | null
          service_id?: string | null
          state?: Database["public"]["Enums"]["record_state"]
          title?: string
          updated_at?: string
          urgency?: number
          workaround?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "problems_knowledge_article_id_fkey"
            columns: ["knowledge_article_id"]
            isOneToOne: false
            referencedRelation: "knowledge_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problems_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problems_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department: string | null
          display_name: string
          id: string
          job_title: string | null
          locale: string
          phone: string | null
          preferences: Json
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          display_name: string
          id: string
          job_title?: string | null
          locale?: string
          phone?: string | null
          preferences?: Json
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          display_name?: string
          id?: string
          job_title?: string | null
          locale?: string
          phone?: string | null
          preferences?: Json
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      record_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          internal: boolean
          organization_id: string
          record_id: string
          record_type: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          internal?: boolean
          organization_id: string
          record_id: string
          record_type: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          internal?: boolean
          organization_id?: string
          record_id?: string
          record_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "record_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      record_counters: {
        Row: {
          current_value: number
          organization_id: string
          prefix: string
          updated_at: string
        }
        Insert: {
          current_value?: number
          organization_id: string
          prefix: string
          updated_at?: string
        }
        Update: {
          current_value?: number
          organization_id?: string
          prefix?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "record_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      request_tasks: {
        Row: {
          assignee_id: string | null
          created_at: string
          due_at: string | null
          id: string
          organization_id: string
          request_id: string
          state: Database["public"]["Enums"]["record_state"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          organization_id: string
          request_id: string
          state?: Database["public"]["Enums"]["record_state"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          organization_id?: string
          request_id?: string
          state?: Database["public"]["Enums"]["record_state"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_tasks_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      service_requests: {
        Row: {
          approval_status: string
          assignee_id: string | null
          catalog_item_id: string | null
          created_at: string
          description: string
          due_at: string | null
          group_id: string | null
          id: string
          number: string
          organization_id: string
          requested_for_id: string | null
          requester_id: string
          state: Database["public"]["Enums"]["record_state"]
          title: string
          updated_at: string
        }
        Insert: {
          approval_status?: string
          assignee_id?: string | null
          catalog_item_id?: string | null
          created_at?: string
          description?: string
          due_at?: string | null
          group_id?: string | null
          id?: string
          number: string
          organization_id: string
          requested_for_id?: string | null
          requester_id: string
          state?: Database["public"]["Enums"]["record_state"]
          title: string
          updated_at?: string
        }
        Update: {
          approval_status?: string
          assignee_id?: string | null
          catalog_item_id?: string | null
          created_at?: string
          description?: string
          due_at?: string | null
          group_id?: string | null
          id?: string
          number?: string
          organization_id?: string
          requested_for_id?: string | null
          requester_id?: string
          state?: Database["public"]["Enums"]["record_state"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_requests_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          code: string
          created_at: string
          criticality: string
          description: string | null
          id: string
          name: string
          organization_id: string
          owner_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          criticality?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          owner_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          criticality?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          owner_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_instances: {
        Row: {
          completed_at: string | null
          created_at: string
          due_at: string
          id: string
          organization_id: string
          paused_at: string | null
          record_id: string
          record_type: string
          started_at: string
          status: string
          target_type: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          due_at: string
          id?: string
          organization_id: string
          paused_at?: string | null
          record_id: string
          record_type: string
          started_at?: string
          status?: string
          target_type: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          due_at?: string
          id?: string
          organization_id?: string
          paused_at?: string | null
          record_id?: string
          record_type?: string
          started_at?: string
          status?: string
          target_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sla_instances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bootstrap_workspace: { Args: { _display_name?: string }; Returns: Json }
      can_access_evidence_path: { Args: { _path: string }; Returns: boolean }
      can_access_record: {
        Args: { _org_id: string; _record_id: string; _record_type: string }
        Returns: boolean
      }
      can_manage: { Args: { _org_id: string }; Returns: boolean }
      core_audit_snapshot: {
        Args: { _row: Json; _table_name: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id?: string }
        Returns: boolean
      }
      itsm_create_change: {
        Args: { _input: Json; _org_id: string }
        Returns: Json
      }
      itsm_create_service_request: {
        Args: {
          _catalog_item_id: string
          _description: string
          _org_id: string
          _title: string
        }
        Returns: Json
      }
      itsm_decide_approval: {
        Args: { _approval_id: string; _decision: string; _notes?: string }
        Returns: Json
      }
      next_record_number: {
        Args: { _org_id: string; _prefix: string }
        Returns: string
      }
    }
    Enums: {
      app_role:
        | "requester"
        | "service_desk"
        | "fulfiller"
        | "change_manager"
        | "cab_member"
        | "cmdb_manager"
        | "manager"
        | "admin"
      record_state:
        | "new"
        | "open"
        | "in_progress"
        | "pending"
        | "resolved"
        | "closed"
        | "cancelled"
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
      app_role: [
        "requester",
        "service_desk",
        "fulfiller",
        "change_manager",
        "cab_member",
        "cmdb_manager",
        "manager",
        "admin",
      ],
      record_state: [
        "new",
        "open",
        "in_progress",
        "pending",
        "resolved",
        "closed",
        "cancelled",
      ],
    },
  },
} as const
