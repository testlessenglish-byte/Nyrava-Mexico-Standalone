// JSON Pipeline Integrity Gate
//
// Hard, deterministic invariants executed before report assembly and before
// final release. A failure here immediately blocks release and logs actionable
// diagnostic context.

import type { Finding } from "./types";
import type { ProceduralPosture } from "./procedural-posture";
import type { ReleaseGateResult } from "./release-gate";

export interface JSONIntegrityViolation {
  rule_id: string;
  severity: "critical" | "warning";
  message: string;
  context?: Record<string, unknown>;
}

export interface JSONIntegrityResult {
  valid: boolean;
  violations: JSONIntegrityViolation[];
  critical_count: number;
  warning_count: number;
}

export function validateJSONPipelineIntegrity(input: {
  caseRow?: Record<string, unknown> | null;
  findings: Finding[];
  posture?: ProceduralPosture;
  releaseGate?: ReleaseGateResult | null;
  isLimitedMode?: boolean;
  recommendationsCount?: number;
  deadlines?: Array<{ deadline_date?: string; label?: string; source?: string }>;
  reportReleased?: boolean;
}): JSONIntegrityResult {
  const violations: JSONIntegrityViolation[] = [];
  const { caseRow, findings, posture, releaseGate, isLimitedMode, recommendationsCount, deadlines, reportReleased } = input;

  // Rule 1: released report + blocked release gate -> FAIL
  if (reportReleased && releaseGate && !releaseGate.ok) {
    violations.push({
      rule_id: "RELEASED_WITH_BLOCKED_GATE",
      severity: "critical",
      message: "Report cannot have status 'released' when release gate is not OK.",
      context: { issues: releaseGate.issues },
    });
  }

  // Rule 2: verified corpus quote + no source document -> FAIL
  for (const rawFinding of findings) {
    const f = rawFinding as any;
    const isVerified = f.verification_status === "verified" || f.audit_classification === "VERIFIED_COURT_HOLDING";
    const hasQuote = Boolean(f.source_quote || f.evidence_refs?.some((e: any) => e.quote));
    const hasDoc = Boolean(f.source_document_id || f.source_doc_ids?.length || f.evidence_refs?.some((e: any) => e.document_id || e.doc_id));
    const isAuthorityExempt = Boolean(f.metadata?.is_authority_exempt || (f.authority_level != null && Number(f.authority_level) > 0));

    if (isVerified && hasQuote && !hasDoc && !isAuthorityExempt) {
      violations.push({
        rule_id: "VERIFIED_QUOTE_WITHOUT_SOURCE_DOCUMENT",
        severity: "critical",
        message: `Finding "${f.title}" is verified against corpus text but lacks a resolvable source document ID.`,
        context: { finding_id: f.id, title: f.title },
      });
    }
  }

  // Rule 3: concluded case + future hearing deadline with no cited source -> FAIL
  if (posture?.is_final_resolution && deadlines && deadlines.length > 0) {
    for (const d of deadlines) {
      if (!d.source && /audiencia|plazo para contestar|ofrecer pruebas/i.test(d.label ?? "")) {
        violations.push({
          rule_id: "CONCLUDED_CASE_UNCITED_FUTURE_DEADLINE",
          severity: "critical",
          message: `Concluded case contains future deadline "${d.label}" with no cited source.`,
          context: { deadline: d },
        });
      }
    }
  }

  // Rule 4: adopted court holding classified as adverse risk without separate reasoning -> FAIL
  for (const rawFinding of findings) {
    const f = rawFinding as any;
    if (f.proposition_type === "holding" && f.adoption_status === "adopted") {
      if (f.impact_direction === "undermining" || (f.severity === "critical" && f.impact_direction !== "neutral" && !f.legal_significance)) {
        violations.push({
          rule_id: "ADOPTED_HOLDING_MISCLASSIFIED_AS_ADVERSE_RISK",
          severity: "critical",
          message: `Adopted holding "${f.title}" is classified as adverse risk without articulated strategic reasoning.`,
          context: { finding_id: f.id, title: f.title },
        });
      }
    }
  }

  // Rule 5: duplicate canonical proposition appearing more than once in reportable findings -> FAIL
  const seenCanonical = new Set<string>();
  for (const f of findings) {
    const cid = (f as any).canonical_finding_id ?? (f.metadata as any)?.canonical_finding_id;
    if (cid && typeof cid === "string") {
      if (seenCanonical.has(cid)) {
        violations.push({
          rule_id: "DUPLICATE_CANONICAL_FINDING_IN_REPORT",
          severity: "critical",
          message: `Canonical finding ID "${cid}" appears multiple times in reportable findings.`,
          context: { canonical_finding_id: cid, duplicate_title: f.title },
        });
      }
      seenCanonical.add(cid);
    }
  }

  // Rule 6: next_stage populated after final resolution without explicit remand/enforcement basis -> FAIL
  if (posture?.is_final_resolution && !posture.remand_ordered && caseRow?.next_stage) {
    violations.push({
      rule_id: "UNSUPPORTED_NEXT_STAGE_AFTER_FINAL_RESOLUTION",
      severity: "warning",
      message: `next_stage "${caseRow.next_stage}" is populated on a concluded resolution with no remand ordered.`,
      context: { next_stage: caseRow.next_stage },
    });
  }

  // Rule 7: recommendation survives while recommendations are supposed to be suppressed in LIMITED mode -> FAIL
  if (isLimitedMode && (recommendationsCount ?? 0) > 0) {
    violations.push({
      rule_id: "RECOMMENDATION_SURVIVED_IN_LIMITED_MODE",
      severity: "critical",
      message: `Actionable recommendations survived (${recommendationsCount}) despite active LIMITED analysis mode.`,
    });
  }

  const criticalCount = violations.filter((v) => v.severity === "critical").length;
  const warningCount = violations.filter((v) => v.severity === "warning").length;

  return {
    valid: criticalCount === 0,
    violations,
    critical_count: criticalCount,
    warning_count: warningCount,
  };
}
