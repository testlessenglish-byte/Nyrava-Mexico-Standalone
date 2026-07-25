/**
 * Nyrava Intelligence Engine — shared types.
 *
 * Every engine (case, legal, evidence, and future witness/timeline/contract/
 * research/work-product) implements the same contract:
 *
 *   run(input, ctx) → EngineOutput
 *
 * Engines never touch the database directly. They return structured
 * knowledge + relationships, and the pipeline persists them under RLS.
 */

export type EngineCode =
  | "case"
  | "legal"
  | "evidence"
  | "witness"
  | "timeline"
  | "litigation"
  | "contract"
  | "research"
  | "work_product";

export type KnowledgeKind =
  | "summary"
  | "fact"
  | "entity"
  | "party"
  | "date"
  | "timeline_event"
  | "issue"
  | "risk"
  | "citation"
  | "authority"
  | "evidence"
  | "contradiction"
  | "recommendation";

export type KnowledgeDraft = {
  /** Stable local id used to reference this row from relationships. */
  ref: string;
  kind: KnowledgeKind;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  confidence?: number;
  language?: "es" | "en";
  source_document_id?: string | null;
};

export type RelationshipDraft = {
  subject_ref: string;
  object_ref: string;
  relation: string;
  weight?: number;
  data?: Record<string, unknown>;
};

export type EngineInput = {
  orgId: string;
  matterId: string;
  language: "es" | "en";
  /** Matter header + documents + prior knowledge summary. */
  context: {
    matter: {
      title: string;
      matter_type: string;
      description: string | null;
      client_name: string | null;
      jurisdiction: string | null;
    };
    documents: {
      id: string;
      title: string;
      media_kind: string | null;
      text_content: string | null;
      classification: Record<string, unknown>;
    }[];
    knowledge: {
      kind: string;
      title: string;
      body: string | null;
    }[];
  };
};

export type EngineOutput = {
  knowledge: KnowledgeDraft[];
  relationships: RelationshipDraft[];
  recommendations?: string[];
  model?: string;
  tokens_used?: number;
};

export interface IntelligenceEngine {
  readonly code: EngineCode;
  readonly label: string;
  run(input: EngineInput): Promise<EngineOutput>;
}
