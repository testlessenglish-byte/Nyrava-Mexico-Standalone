import { describe, expect, it } from "vitest";
import { computeDeterministicScorecard, findingScoringDirection, scrubScoringContributors } from "../scoring.server";
import type { Finding } from "../types";

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: "f-1",
    case_id: "case-1",
    user_id: "user-1",
    source_module: "agent:constitutional_rights_mapping",
    category: "constitutional",
    title: "Derecho a una doble instancia",
    description: "La SCJN reconoció el derecho y declaró inconstitucional la norma impugnada.",
    severity: "high",
    confidence: 0.95,
    legal_significance: null,
    potential_impact: null,
    affected_party: "defense",
    source_doc_ids: ["doc-1"],
    evidence_refs: [{ quote: "resulta inconstitucional la fracción IV" }],
    related_finding_ids: [],
    tags: ["dimension:constitutional_compliance"],
    metadata: {},
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:00:00Z",
    ...overrides,
  };
}

describe("verified Amparo scoring", () => {
  it("does not turn an adopted SCJN constitutional holding into a constitutional defect", () => {
    const holding = finding({
      audit_classification: "VERIFIED_COURT_HOLDING",
      proposition_type: "holding",
      adoption_status: "adopted",
    });
    expect(findingScoringDirection(holding)).toBe("neutral");
    const score = computeDeterministicScorecard([holding], "amparo");
    expect(score.dimensions.constitutional_compliance.score).toBe(80);
    expect(score.dimensions.constitutional_compliance.negatives).toHaveLength(0);
  });

  it("allows an explicitly adverse verified finding to weaken the dimension", () => {
    const adverse = finding({
      id: "f-2",
      audit_classification: "VERIFIED_FACT",
      impact_direction: "weakens",
      title: "Violación procesal acreditada",
      category: "constitutional",
    });
    const score = computeDeterministicScorecard([adverse], "amparo");
    expect(score.dimensions.constitutional_compliance.score).toBeLessThan(80);
  });

  it("does not let POTENTIAL_ISSUE or EVIDENCE_GAP move an attorney-facing score", () => {
    const potential = finding({ id: "f-3", audit_classification: "POTENTIAL_ISSUE", category: "constitutional" });
    const gap = finding({ id: "f-4", audit_classification: "EVIDENCE_GAP", category: "constitutional" });
    const score = computeDeterministicScorecard([potential, gap], "amparo");
    expect(score.dimensions.constitutional_compliance.score).toBe(80);
    expect(score.dimensions.constitutional_compliance.contributor_count).toBe(0);
  });

  it("scrubs penal-trial LLM contributor text from non-penal score fallback", () => {
    const valid = new Set(["f-1"]);
    const rows = scrubScoringContributors(
      [
        { label: "Cadena de custodia documentada", finding_id: "f-1" },
        { label: "Informe policial homologado", finding_id: "f-1" },
        { label: "Falta de evidencia de medidas cautelares", finding_id: "f-1" },
        { label: "Resolución judicial verificada", finding_id: "f-1" },
      ],
      { criminalLike: false, validFindingIds: valid },
    );
    expect(rows.map((r) => r.label)).toEqual(["Resolución judicial verificada"]);
  });
});
