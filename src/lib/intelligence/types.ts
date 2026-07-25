// Canonical Nyrava Intelligence types — shared by every engine and reader.

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type AffectedParty = "defense" | "prosecution" | "both" | "neutral";

export type EvidenceType = "inculpatory" | "exculpatory" | "impeachment" | "neutral";
export type ImpactDirection = "strengthens" | "weakens" | "neutral";

export type Finding = {
  id: string;
  case_id: string;
  user_id: string;
  source_module: string;
  category: string;
  title: string;
  description: string;
  severity: Severity;
  confidence: number;
  legal_significance: string | null;
  potential_impact: string | null;
  affected_party: AffectedParty | null;
  evidence_type?: EvidenceType | null;
  impact_direction?: ImpactDirection | null;
  strategic_significance?: string | null;
  priority?: number | null;
  source_doc_ids: string[];
  evidence_refs: Array<{ label?: string; quote?: string; doc_id?: string }>;
  related_finding_ids: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type NewFinding = Omit<
  Finding,
  "id" | "created_at" | "updated_at" | "source_doc_ids" | "evidence_refs" | "related_finding_ids" | "tags" | "metadata"
> & {
  source_doc_ids?: string[];
  evidence_refs?: Finding["evidence_refs"];
  related_finding_ids?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type ScoreContributor = {
  label: string;
  weight: number;        // -100..100
  finding_id?: string;
};

export type ExplainableScore = {
  positive_contributors: ScoreContributor[];
  negative_contributors: ScoreContributor[];
  confidence: number;
  reasoning: string;
};

export type Theory = {
  theory_type: "prosecution" | "defense" | "alternative" | "unknown";
  narrative: string;
  supporting_evidence: string[];
  contradicting_evidence: string[];
  missing_evidence: string[];
  confidence: number;
  risk: string;
  key_assumptions: string[];
};

export type Opportunity = {
  side: "defense" | "prosecution";
  opportunity_type: string;
  title: string;
  description: string;
  recommended_motions: string[];
  recommended_questions: string[];
  recommended_investigations: string[];
  counter_response?: string;
  severity: Severity;
  confidence: number;
  source_finding_ids?: string[];
};

export type WitnessProfile = {
  name: string;
  role: string;
  reliability: number;
  bias: number;
  consistency: number;
  corroboration: number;
  observation_opportunity: number;
  credibility_risk: number;
  cross_exam_questions: string[];
  impeachment_questions: string[];
  follow_up_questions: string[];
  rationale: Record<string, string>;
};

export type TrialPrep = {
  opening_themes: string[];
  closing_themes: string[];
  witness_order: Array<{ name: string; reason: string }>;
  exhibit_order: Array<{ exhibit: string; reason: string }>;
  likely_objections: Array<{ objection: string; counter: string }>;
  trial_risks: string[];
  trial_strengths: string[];
  jury_concerns: string[];
  jury_conviction_pct: number;
  jury_acquittal_pct: number;
  jury_appeal_pct: number;
  jury_settlement_pct: number;
  most_persuasive_evidence: string[];
  most_damaging_evidence: string[];
};

export type WorkProductDoc = {
  document_type:
    | "motion_to_suppress"
    | "motion_to_dismiss"
    | "discovery_request"
    | "cross_exam_plan"
    | "witness_prep"
    | "trial_outline"
    | "case_summary";
  title: string;
  body_markdown: string;
  cited_finding_ids?: string[];
};
