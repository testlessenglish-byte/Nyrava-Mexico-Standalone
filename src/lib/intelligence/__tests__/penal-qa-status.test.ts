import { describe, expect, it } from "vitest";
import { buildPenalQaStatuses } from "@/lib/intelligence/penal-qa-status";

describe("independent Penal QA statuses", () => {
  it("keeps all six layers independent", () => {
    const result = buildPenalQaStatuses({
      applicable: true,
      citationQuarantined: 2,
      hallucinationEngineStatus: "completed",
      classificationConflicts: 0,
      proceduralSemanticIssues: 1,
      renderedCriticalIssues: 0,
      releaseGateIssues: 3,
      qualityBlocked: false,
    });
    expect(result.map((row) => row.layer)).toEqual([
      "citation_integrity",
      "legal_grounding_hallucination",
      "classification_fidelity",
      "procedural_semantics",
      "rendering_consistency",
      "release_readiness",
    ]);
    expect(result.map((row) => row.status)).toEqual([
      "WARN",
      "PASS",
      "PASS",
      "FAIL",
      "PASS",
      "WARN_NON_BLOCKING",
    ]);
  });

  it("does not turn an unavailable layer into a false pass", () => {
    const result = buildPenalQaStatuses({
      applicable: true,
      citationQuarantined: null,
      hallucinationEngineStatus: null,
      classificationConflicts: 0,
      proceduralSemanticIssues: 0,
      renderedCriticalIssues: null,
      releaseGateIssues: null,
      qualityBlocked: false,
    });
    expect(result.find((row) => row.layer === "citation_integrity")?.status).toBe("WARN");
    expect(result.find((row) => row.layer === "rendering_consistency")?.status).toBe("WARN");
    expect(result.find((row) => row.layer === "release_readiness")?.status).toBe("WARN");
  });
});
