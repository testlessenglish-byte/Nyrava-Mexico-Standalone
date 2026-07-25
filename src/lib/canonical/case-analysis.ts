// Canonical CaseAnalysis — the 17-section single source of truth.
//
// All completed pipelines project their engine output into this exact shape,
// which is what the report renderer, PDF/DOCX/JSON exports, and validator
// operate against. Empty sections are represented explicitly (empty arrays,
// `null`, or `{ status: "missing", reason }`) — never omitted — so the
// validator and renderer can distinguish "engine ran and found nothing" from
// "engine never ran".
//
// Report Engine v1.0 — the 17-section contract is locked. See docs/FREEZE.md.
// Sections may not be added, removed, renamed, or reordered without a new
// release tag and documented business justification.

import { assertSectionsLocked, LOCKED_CANONICAL_SECTIONS, REPORT_ENGINE_VERSION } from "./sections.lock";

export type Citation = {
  documentId?: string | null;
  page?: number | null;
  quote?: string | null;
  label?: string | null;
};

export type Finding = {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: number; // 0..1
  legal_significance?: string | null;
  potential_impact?: string | null;
  affected_party?: string | null;
  citations: Citation[];
  suppressed?: boolean;
  quarantined?: boolean;
  verification_status?: string | null;
};

export type Witness = {
  id: string;
  name: string;
  role?: string | null;
  reliability?: number | null;
  bias?: string | null;
  credibility_risk?: string | null;
  citations: Citation[];
};

export type TimelineEvent = {
  id: string;
  date?: string | null;
  description: string;
  citations: Citation[];
};

export type Contradiction = {
  id: string;
  claim: string;
  counter: string;
  severity: "critical" | "high" | "medium" | "low";
  citations: Citation[];
};

export type DiscoveryGap = {
  id: string;
  topic: string;
  what_is_missing: string;
  why_it_matters: string;
  citations: Citation[];
};

export type Risk = {
  id: string;
  label: string;
  severity: "critical" | "high" | "medium" | "low";
  mitigation?: string | null;
};

export type ScoreSection = {
  case_strength?: number | null;
  evidence_strength?: number | null;
  witness_reliability?: number | null;
  timeline_integrity?: number | null;
  overall_confidence?: number | null;
  rationale?: string | null;
  suppressed?: boolean;
};

export type Recommendation = {
  id: string;
  action: string;
  priority: "immediate" | "high" | "medium" | "low";
  rationale?: string | null;
};

export type Strategy = {
  theme?: string | null;
  theories: Array<{ id: string; label: string; rationale?: string | null }>;
  key_moves: string[];
};

export type CrossExamPlan = {
  witnessName: string;
  questions: string[];
  citations: Citation[];
};

export type ImpeachmentItem = {
  witnessName: string;
  basis: string;
  citations: Citation[];
};

export type WorkProductDoc = {
  id: string;
  kind: string; // motion, brief, memo, letter
  title: string;
  body: string;
  citations: Citation[];
  verification?: { status: "clean" | "flagged" | "rejected" | "empty"; notes?: string | null };
};

export type ExecutiveSummary = {
  headline: string;
  narrative: string;
  top_findings: string[]; // finding IDs
  case_type?: string | null;
};

export type Facts = {
  narrative: string;
  key_actors: string[];
  disputed_facts: string[];
};

export type Appendices = {
  source_documents: Array<{ id: string; name: string; page_count?: number | null }>;
  citation_index: Citation[];
  suppressed_notices: string[];
};

export type CanonicalMetadata = {
  caseId: string;
  caseName?: string | null;
  generatedAt: string;
  pipelineVersion: string;
  reportMode: "FULL" | "LIMITED";
  engineFingerprints?: Record<string, string>;
};

export interface CaseAnalysis {
  _canonical: true;
  Metadata: CanonicalMetadata;
  ExecutiveSummary: ExecutiveSummary;
  Facts: Facts;
  Timeline: TimelineEvent[];
  Evidence: Finding[];
  Findings: Finding[]; // superset; Evidence is filtered subset
  Witnesses: Witness[];
  Contradictions: Contradiction[];
  Discovery: DiscoveryGap[];
  Risks: Risk[];
  Scores: ScoreSection;
  Recommendations: Recommendation[];
  Strategy: Strategy;
  CrossExam: CrossExamPlan[];
  Impeachment: ImpeachmentItem[];
  WorkProduct: WorkProductDoc[];
  Appendices: Appendices;
}

export const CANONICAL_SECTIONS: (keyof CaseAnalysis)[] = [
  "Metadata",
  "ExecutiveSummary",
  "Facts",
  "Timeline",
  "Evidence",
  "Findings",
  "Witnesses",
  "Contradictions",
  "Discovery",
  "Risks",
  "Scores",
  "Recommendations",
  "Strategy",
  "CrossExam",
  "Impeachment",
  "WorkProduct",
  "Appendices",
];

// Runtime enforcement: the module-level section list must match the locked
// Report Engine v1.0 contract. This assertion will fail at import time if
// a future edit changes the section list.
assertSectionsLocked(CANONICAL_SECTIONS);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationIssue = {
  section: string;
  code:
    | "missing_section"
    | "extra_section"
    | "empty_required"
    | "missing_citation"
    | "invalid_citation"
    | "placeholder_value"
    | "hallucinated"
    | "unsupported_conclusion";
  message: string;
  ref?: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

const PLACEHOLDER_PATTERNS = [
  /\bTBD\b/i,
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bplaceholder\b/i,
  /\blorem ipsum\b/i,
  /\bXXX+\b/,
];

function looksLikePlaceholder(s: string | null | undefined): boolean {
  if (!s || typeof s !== "string") return false;
  return PLACEHOLDER_PATTERNS.some((p) => p.test(s));
}

function hasValidCitation(cites: Citation[] | undefined | null): boolean {
  if (!Array.isArray(cites) || cites.length === 0) return false;
  return cites.some((c) => !!(c && (c.documentId || c.quote)));
}

export function validateCaseAnalysis(analysis: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const push = (issue: ValidationIssue) => issues.push(issue);

  if (!analysis || typeof analysis !== "object") {
    return { ok: false, issues: [{ section: "root", code: "missing_section", message: "Analysis payload is not an object." }] };
  }
  const a = analysis as Partial<CaseAnalysis>;

  for (const section of CANONICAL_SECTIONS) {
    if (!(section in a)) {
      push({ section, code: "missing_section", message: `Missing required section: ${section}` });
    }
  }

  // Metadata
  if (a.Metadata) {
    if (!a.Metadata.caseId) push({ section: "Metadata", code: "empty_required", message: "Metadata.caseId is required." });
    if (!a.Metadata.generatedAt) push({ section: "Metadata", code: "empty_required", message: "Metadata.generatedAt is required." });
  }

  // ExecutiveSummary
  if (a.ExecutiveSummary) {
    if (!a.ExecutiveSummary.headline?.trim()) push({ section: "ExecutiveSummary", code: "empty_required", message: "ExecutiveSummary.headline is empty." });
    if (looksLikePlaceholder(a.ExecutiveSummary.headline)) push({ section: "ExecutiveSummary", code: "placeholder_value", message: "ExecutiveSummary.headline contains a placeholder." });
    if (looksLikePlaceholder(a.ExecutiveSummary.narrative)) push({ section: "ExecutiveSummary", code: "placeholder_value", message: "ExecutiveSummary.narrative contains a placeholder." });
  }

  // Findings — every non-suppressed finding needs at least one citation.
  const findings = Array.isArray(a.Findings) ? a.Findings : [];
  for (const f of findings) {
    if (f.suppressed || f.quarantined) continue;
    if (!f.title?.trim()) push({ section: "Findings", code: "empty_required", message: "Finding missing title.", ref: f.id });
    if (looksLikePlaceholder(f.title) || looksLikePlaceholder(f.description)) {
      push({ section: "Findings", code: "placeholder_value", message: `Finding "${f.title}" contains a placeholder.`, ref: f.id });
    }
    if (!hasValidCitation(f.citations)) {
      push({ section: "Findings", code: "missing_citation", message: `Finding "${f.title}" has no supporting citation.`, ref: f.id });
    }
    if (typeof f.confidence !== "number" || f.confidence < 0 || f.confidence > 1) {
      push({ section: "Findings", code: "unsupported_conclusion", message: `Finding "${f.title}" has invalid confidence.`, ref: f.id });
    }
  }

  // Witnesses — a stated witness must cite the source document.
  for (const w of Array.isArray(a.Witnesses) ? a.Witnesses : []) {
    if (!w.name?.trim()) push({ section: "Witnesses", code: "empty_required", message: "Witness missing name.", ref: w.id });
    if (!hasValidCitation(w.citations)) push({ section: "Witnesses", code: "missing_citation", message: `Witness "${w.name}" has no source citation.`, ref: w.id });
  }

  // Contradictions
  for (const c of Array.isArray(a.Contradictions) ? a.Contradictions : []) {
    if (!hasValidCitation(c.citations)) push({ section: "Contradictions", code: "missing_citation", message: "Contradiction missing citation.", ref: c.id });
  }

  // WorkProduct — rejected docs surface as unsupported conclusions.
  for (const w of Array.isArray(a.WorkProduct) ? a.WorkProduct : []) {
    if (w.verification?.status === "rejected") {
      push({ section: "WorkProduct", code: "unsupported_conclusion", message: `Work product "${w.title}" was rejected by the verifier.`, ref: w.id });
    }
    if (!hasValidCitation(w.citations) && w.verification?.status !== "empty") {
      push({ section: "WorkProduct", code: "missing_citation", message: `Work product "${w.title}" has no supporting citations.`, ref: w.id });
    }
  }

  return { ok: issues.length === 0, issues };
}

export function strictValidateCaseAnalysis(analysis: unknown): ValidationResult {
  const result = validateCaseAnalysis(analysis);
  if (!analysis || typeof analysis !== "object") return result;

  const a = analysis as Partial<CaseAnalysis>;
  const locked = new Set<string>(LOCKED_CANONICAL_SECTIONS);
  for (const key of Object.keys(a)) {
    if (key === "_canonical") continue; // marker field, not a report section
    if (!locked.has(key)) {
      result.issues.push({
        section: key,
        code: "extra_section",
        message: `Section "${key}" is not part of Report Engine v${REPORT_ENGINE_VERSION}. New sections require a version bump and documented business justification.`,
      });
      result.ok = false;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// countFindings — canonical validated findings only
// ---------------------------------------------------------------------------

export function countFindings(analysis: Pick<CaseAnalysis, "Findings"> | null | undefined): number {
  const findings = analysis?.Findings;
  if (!Array.isArray(findings)) return 0;
  const seen = new Set<string>();
  let count = 0;
  for (const f of findings) {
    if (!f || f.suppressed || f.quarantined) continue;
    if (f.verification_status && /reject|quarantin/i.test(f.verification_status)) continue;
    const key = f.id || `${f.title}::${f.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Empty scaffold — used as a starting point by the writer.
// ---------------------------------------------------------------------------

export function emptyCaseAnalysis(meta: CanonicalMetadata): CaseAnalysis {
  return {
    _canonical: true,
    Metadata: meta,
    ExecutiveSummary: { headline: "", narrative: "", top_findings: [], case_type: null },
    Facts: { narrative: "", key_actors: [], disputed_facts: [] },
    Timeline: [],
    Evidence: [],
    Findings: [],
    Witnesses: [],
    Contradictions: [],
    Discovery: [],
    Risks: [],
    Scores: {},
    Recommendations: [],
    Strategy: { theme: null, theories: [], key_moves: [] },
    CrossExam: [],
    Impeachment: [],
    WorkProduct: [],
    Appendices: { source_documents: [], citation_index: [], suppressed_notices: [] },
  };
}
