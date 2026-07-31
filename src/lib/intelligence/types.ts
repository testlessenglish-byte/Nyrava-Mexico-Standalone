// Canonical Nyrava Intelligence types — shared by every engine and reader.

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type AffectedParty = "defense" | "prosecution" | "both" | "neutral";

export type EvidenceType = "inculpatory" | "exculpatory" | "impeachment" | "neutral";
export type ImpactDirection = "strengthens" | "weakens" | "neutral";

/** Addendum §25 — a single confidence float can't distinguish "the OCR is
 * shaky but the legal rule is crystal clear" from "the OCR is perfect but
 * the procedural stage is unknown." Each dimension is independent; none of
 * them collapse into the others. See confidence-dimensions.ts. Optional and
 * additive — the existing scalar `confidence` on Finding is untouched and
 * still drives all existing scoring math. */
export type ConfidenceLevel = "high" | "moderate" | "low" | "indeterminate";
export type ConfidenceDimension = { level: ConfidenceLevel; reason: string };
export type ConfidenceDimensions = {
  extraction: ConfidenceDimension;
  factual: ConfidenceDimension;
  evidence_quality: ConfidenceDimension;
  legal: ConfidenceDimension;
  procedural: ConfidenceDimension;
  corpus_completeness: ConfidenceDimension;
  classification: ConfidenceDimension;
};

/** Addendum §23 — an auditable legal rationale, not private chain-of-thought:
 * what supports this conclusion, what weakens it, what's assumed, what's
 * unresolved. Optional and additive. */
export type FindingRationale = {
  supporting_evidence: string[];
  contrary_evidence: string[];
  assumptions: string[];
  unresolved_questions: string[];
  applicable_authority: string[];
  attorney_review_required: boolean;
  /** True if the raw model text leaned on an unsupported-conclusion phrase
   * ("es probable", "se recomienda promover", ...) without an accompanying
   * evidence/authority reference. See BANNED_UNSUPPORTED_PHRASES. */
  unsupported_language_flagged: boolean;
};

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
  confidence_dimensions?: ConfidenceDimensions | null;
  rationale?: FindingRationale | null;
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
  | "id"
  | "created_at"
  | "updated_at"
  | "source_doc_ids"
  | "evidence_refs"
  | "related_finding_ids"
  | "tags"
  | "metadata"
> & {
  source_doc_ids?: string[];
  evidence_refs?: Finding["evidence_refs"];
  related_finding_ids?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type ScoreContributor = {
  label: string;
  weight: number; // -100..100
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
  /**
   * Mexican procedural drafting vehicle id — see
   * src/lib/jurisdiction/mx-work-product.ts, which is materia-aware
   * (`demanda_de_amparo`, `solicitud_exclusion_prueba_ilicita`,
   * `recurso_de_revocacion`, …). Previously a fixed U.S. union
   * (motion_to_suppress | motion_for_summary_judgment | discovery_request),
   * none of which are Mexican instruments. `case_summary` is preserved as the
   * factual-summary id because the report/PDF gate keys on it.
   */
  document_type: string;
  title: string;
  body_markdown: string;
  cited_finding_ids?: string[];
};
