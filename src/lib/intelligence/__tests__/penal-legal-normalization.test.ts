import { describe, expect, it } from "vitest";
import { normalizePenalFinding } from "../penal-legal-normalization";
import type { NewFinding } from "../types";

const finding = (overrides: Partial<NewFinding>): NewFinding =>
  ({
    case_id: "case-penal",
    user_id: "user-1",
    source_module: "agent:witness_credibility",
    category: "witness_credibility",
    title: "Finding",
    description: "Description",
    severity: "high",
    confidence: 0.9,
    legal_significance: null,
    potential_impact: null,
    affected_party: "defense",
    evidence_refs: [{ doc_id: "doc-1", quote: "Cita verificada." }],
    metadata: {},
    ...overrides,
  }) as NewFinding;

describe("Penal legal normalization", () => {
  it("preserves a rejected lower-court holding as rejected", () => {
    const result = normalizePenalFinding(
      finding({
        speaker_role: "tribunal_local",
        proposition_type: "rejected_holding",
        adoption_status: "adopted",
        impact_direction: "strengthens",
      }),
      { matter: "penal" },
    );

    expect(result.proposition_type).toBe("rejected_holding");
    expect(result.adoption_status).toBe("rejected");
    expect(result.category).toBe("rejected_holding");
  });

  it("keeps an adopted court holding neutral despite witness-agent provenance", () => {
    const result = normalizePenalFinding(
      finding({
        speaker_role: "scjn",
        proposition_type: "holding",
        adoption_status: "adopted",
        impact_direction: "weakens",
        evidence_type: "impeachment",
      }),
      { matter: "penal" },
    );

    expect(result.proposition_type).toBe("court_holding");
    expect(result.category).toBe("court_holding");
    expect(result.impact_direction).toBe("neutral");
    expect(result.affected_party).toBe("neutral");
    expect(result.evidence_type).toBe("neutral");
  });

  it("does not let a party position become a court holding", () => {
    const result = normalizePenalFinding(
      finding({
        speaker_role: "ministerio_publico",
        proposition_type: "holding",
        adoption_status: "adopted",
      }),
      { matter: "penal" },
    );

    expect(result.proposition_type).toBe("prosecution_position");
    expect(result.adoption_status).toBe("party_position");
    expect(result.category).toBe("prosecution_position");
  });

  it("preserves an explicit, sourced party-aware score mapping", () => {
    const result = normalizePenalFinding(
      finding({
        speaker_role: "tribunal_alzada",
        proposition_type: "court_holding",
        adoption_status: "adopted",
        impact_direction: "weakens",
        affected_party: "prosecution",
        benefited_party: "defense",
        score_dimension: "conviction_stability",
        reason_for_score_effect: "The appellate holding excludes the only identification.",
      }),
      { matter: "amparo", underlyingMatter: "penal" },
    );

    expect(result.impact_direction).toBe("weakens");
    expect(result.affected_party).toBe("prosecution");
  });

  it("downgrades an alleged gap when the six-part absence basis is not proven", () => {
    const result = normalizePenalFinding(
      finding({
        proposition_type: "evidence_gap",
        category: "missing_evidence",
        description: "No chain-of-custody form was found.",
        impact_direction: "weakens",
        metadata: { evidence_gap_basis: { expected_in_record: true } },
      }),
      { matter: "penal" },
    );

    expect(result.proposition_type).toBe("unresolved_question");
    expect(result.category).toBe("corpus_gap");
    expect(result.impact_direction).toBe("neutral");
    expect(result.description).toContain("Not available in the uploaded corpus");
  });

  it("retains a proven evidence gap", () => {
    const result = normalizePenalFinding(
      finding({
        proposition_type: "evidence_gap",
        metadata: {
          evidence_gap_basis: {
            expected_in_record: true,
            relevant_to_outcome: true,
            production_or_admission_required: true,
            materially_absent: true,
            prejudice_explained: true,
            record_support: true,
          },
        },
      }),
      { matter: "penal" },
    );

    expect(result.proposition_type).toBe("evidence_gap");
    expect(result.category).toBe("evidence_gap");
  });

  it("does not alter a non-Penal matter", () => {
    const input = finding({ proposition_type: "holding", impact_direction: "weakens" });
    expect(normalizePenalFinding(input, { matter: "civil" })).toBe(input);
  });
});
