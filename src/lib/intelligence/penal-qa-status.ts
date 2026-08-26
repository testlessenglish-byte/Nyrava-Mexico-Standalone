import type { Finding } from "./types";

export type PenalQaStatus = "PASS" | "WARN" | "FAIL" | "NOT_APPLICABLE";

export type PenalQaLayer =
  | "citation_integrity"
  | "legal_grounding_hallucination"
  | "classification_fidelity"
  | "procedural_semantics"
  | "rendering_consistency"
  | "release_readiness";

export type PenalQaLayerResult = {
  layer: PenalQaLayer;
  status: PenalQaStatus;
  issues: number;
  reason: string;
};

export type PenalQaInputs = {
  applicable: boolean;
  citationQuarantined: number | null;
  hallucinationEngineStatus: string | null;
  classificationConflicts: number;
  proceduralSemanticIssues: number;
  renderedCriticalIssues: number | null;
  releaseGateIssues: number | null;
  qualityBlocked: boolean;
};

function count(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

export function auditPenalProceduralSemantics(findings: readonly Finding[]): number {
  let issues = 0;
  for (const finding of findings) {
    const sourceType = String(finding.source_actor_type ?? "");
    const adoption = String(finding.adoption_status ?? "");
    const polarity = String(finding.holding_polarity ?? "");
    const effect = String(finding.operative_effect ?? "");

    if (sourceType === "court" && finding.classification === "VERIFIED_COURT_HOLDING") {
      if (!["adopted", "rejected", "limited", "distinguished", "neutral"].includes(adoption)) {
        issues += 1;
      }
      if (!["favorable", "unfavorable", "mixed", "neutral"].includes(polarity)) {
        issues += 1;
      }
      if (!effect) issues += 1;
    }
    if (
      ["party", "prosecution", "defense", "tercero_interesado"].includes(sourceType) &&
      adoption === "adopted" &&
      finding.classification === "VERIFIED_COURT_HOLDING"
    ) {
      issues += 1;
    }
  }
  return issues;
}

export function buildPenalQaStatuses(input: PenalQaInputs): PenalQaLayerResult[] {
  if (!input.applicable) {
    return (
      [
        "citation_integrity",
        "legal_grounding_hallucination",
        "classification_fidelity",
        "procedural_semantics",
        "rendering_consistency",
        "release_readiness",
      ] as PenalQaLayer[]
    ).map((layer) => ({
      layer,
      status: "NOT_APPLICABLE",
      issues: 0,
      reason: "not_a_penal_matter",
    }));
  }

  const citationIssues = count(input.citationQuarantined);
  const proceduralIssues = count(input.proceduralSemanticIssues);
  const renderedIssues = count(input.renderedCriticalIssues);
  const releaseIssues = count(input.releaseGateIssues);
  const hallucinationStatus = String(input.hallucinationEngineStatus ?? "").toLowerCase();

  return [
    {
      layer: "citation_integrity",
      status: input.citationQuarantined == null ? "WARN" : citationIssues ? "WARN" : "PASS",
      issues: citationIssues,
      reason:
        input.citationQuarantined == null
          ? "citation_audit_unavailable"
          : citationIssues
            ? "unsupported_citations_quarantined"
            : "all_rendered_citations_supported",
    },
    {
      layer: "legal_grounding_hallucination",
      status:
        hallucinationStatus === "completed" || hallucinationStatus === "completed_negative"
          ? "PASS"
          : hallucinationStatus === "failed"
            ? "FAIL"
            : "WARN",
      issues: hallucinationStatus === "failed" ? 1 : 0,
      reason: hallucinationStatus
        ? `hallucination_engine_${hallucinationStatus}`
        : "hallucination_engine_status_unavailable",
    },
    {
      layer: "classification_fidelity",
      status: input.classificationConflicts > 0 ? "FAIL" : "PASS",
      issues: count(input.classificationConflicts),
      reason:
        input.classificationConflicts > 0
          ? "verified_case_identity_conflict"
          : "case_identity_consistent",
    },
    {
      layer: "procedural_semantics",
      status: proceduralIssues > 0 ? "FAIL" : "PASS",
      issues: proceduralIssues,
      reason: proceduralIssues ? "invalid_penal_semantic_records" : "canonical_semantics_valid",
    },
    {
      layer: "rendering_consistency",
      status:
        input.renderedCriticalIssues == null ? "WARN" : renderedIssues > 0 ? "FAIL" : "PASS",
      issues: renderedIssues,
      reason:
        input.renderedCriticalIssues == null
          ? "rendered_report_qa_unavailable"
          : renderedIssues
            ? "critical_rendering_inconsistencies"
            : "rendered_report_consistent",
    },
    {
      layer: "release_readiness",
      status:
        input.qualityBlocked || releaseIssues > 0
          ? "FAIL"
          : input.releaseGateIssues == null
            ? "WARN"
            : "PASS",
      issues: releaseIssues + (input.qualityBlocked ? 1 : 0),
      reason: input.qualityBlocked
        ? "quality_blocked"
        : releaseIssues
          ? "release_gate_mismatch"
          : input.releaseGateIssues == null
            ? "release_gate_unavailable"
            : "release_gate_passed",
    },
  ];
}
