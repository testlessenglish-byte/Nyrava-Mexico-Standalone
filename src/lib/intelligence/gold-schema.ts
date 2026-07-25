// Gold-standard regression schema — Phase 7 Phase A.
//
// Every fixture on disk conforms to this shape. Freezing the schema up front
// prevents drift as we scale from 5 exemplars to 20-30 cases.
//
// Layout:
//   src/lib/intelligence/__tests__/fixtures/gold/<slug>/
//     case.json      — GoldCase (metadata)
//     expected.json  — GoldExpected (all attorney-grade artifacts)

export type PracticeArea =
  | "criminal_felony"
  | "criminal_property"
  | "civil_litigation"
  | "employment"
  | "personal_injury"
  | "family"
  | "medical_malpractice"
  | "tax_law"
  | "corporate"
  | "commercial"
  | "ip"
  | "real_estate"
  | "estate"
  | "securities"
  | "banking"
  | "fintech";

export interface GoldCase {
  id: string;
  slug: string;
  practice_area: PracticeArea;
  title: string;
  description: string;
  document_ids: string[];
  entity_ids: string[];
}

export interface GoldEntity {
  id: string;
  type: "person" | "org" | "location" | "vehicle" | "asset";
  name: string;
  role?: string;
}
export interface GoldTimelineEvent {
  id: string;
  date_iso: string;
  event: string;
  source_document_id: string;
}
export interface GoldEvidence {
  id: string;
  document_id: string;
  page: number;
  description: string;
  classification: string;
  chain_of_custody?: string;
}
export interface GoldFinding {
  id: string;
  category:
    | "contradiction"
    | "brady"
    | "giglio"
    | "discovery_gap"
    | "constitutional"
    | "chain_of_custody"
    | "motion"
    | "risk"
    | "theory"
    | "general";
  title: string;
  description: string;
  source_document_id: string;
  source_page: number;
  source_quote: string;
  evidence_refs: string[];
}
export interface GoldContradiction {
  id: string;
  finding_a_id: string;
  finding_b_id: string;
  description: string;
}
export interface GoldDiscoveryGap {
  id: string;
  category: string;
  description: string;
  requested_from: string;
}
export interface GoldConstitutional {
  id: string;
  amendment: string;
  issue: string;
  severity: "low" | "medium" | "high";
}
export interface GoldBrady {
  id: string;
  category: "exculpatory" | "impeachment" | "mitigating";
  description: string;
}
export interface GoldChainOfCustody {
  id: string;
  item: string;
  gap: string;
}
export interface GoldMotion {
  id: string;
  title: string;
  basis: string;
  likelihood: "low" | "medium" | "high";
}
export interface GoldRisk {
  id: string;
  category: string;
  description: string;
  severity: "low" | "medium" | "high";
}
export interface GoldTheory {
  id: string;
  label: string;
  support: string[];
  strength: "weak" | "moderate" | "strong";
}
export interface GoldReportSection {
  key: string;
  title: string;
  required: boolean;
}

export interface GoldExpected {
  entities: GoldEntity[];
  timeline: GoldTimelineEvent[];
  evidence_map: GoldEvidence[];
  findings: GoldFinding[];
  contradictions: GoldContradiction[];
  discovery_gaps: GoldDiscoveryGap[];
  constitutional: GoldConstitutional[];
  brady: GoldBrady[];
  chain_of_custody: GoldChainOfCustody[];
  motions: GoldMotion[];
  risks: GoldRisk[];
  theories: GoldTheory[];
  report_sections: GoldReportSection[];
}

/** Fixture loader result. */
export interface GoldFixture {
  case: GoldCase;
  expected: GoldExpected;
}

/** Required report sections that every practice area must emit. */
export const REQUIRED_REPORT_SECTIONS = [
  "case_summary",
  "timeline",
  "entities",
  "evidence_map",
  "findings",
  "risks",
  "citations_audit",
] as const;

/** Categories the Reliability Score groups results under. */
export const RELIABILITY_CATEGORIES = [
  "pipeline",
  "persistence",
  "telemetry",
  "replay_metadata",
  "evidence_mapping",
  "timeline",
  "report_assembly",
  "citation_audit",
  "dependency_blocking",
  "json_validation",
  "entities",
  "contradictions",
  "discovery_gaps",
  "constitutional",
  "brady",
  "chain_of_custody",
  "motions",
  "risks",
  "theories",
] as const;

export type ReliabilityCategory = (typeof RELIABILITY_CATEGORIES)[number];
