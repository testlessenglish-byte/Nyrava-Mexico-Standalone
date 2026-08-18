import { describe, expect, it } from "vitest";
import { buildObjectiveBlock } from "./objective";

describe("goal-first objective posture", () => {
  it("uses decision-audit language when an amparo corpus contains verified court holdings", () => {
    const result = buildObjectiveBlock({
      caseType: "amparo",
      locale: "es",
      documentsTotal: 1,
      findings: [
        {
          id: "holding-1",
          title: "Inoperancia de agravios novedosos",
          severity: "high",
          audit_classification: "VERIFIED_COURT_HOLDING",
          proposition_type: "holding",
          adoption_status: "adopted",
          legal_significance: "El órgano jurisdiccional declaró inoperante el agravio.",
        },
      ],
    });

    expect(result.question).toMatch(/Qué resolvió el órgano jurisdiccional/i);
    expect(result.question).not.toMatch(/efectos suspensionales/i);
    expect(result.answer).not.toMatch(/acto reclamado|interés jurídico/i);
    expect(result.decision_points[0].next_action).toMatch(/engrose|puntos resolutivos/i);
  });

  it("does not convert a high-severity court holding into a favorable/adverse litigation-risk conclusion", () => {
    const result = buildObjectiveBlock({
      caseType: "amparo",
      locale: "es",
      documentsTotal: 1,
      findings: [
        {
          title: "No se vulnera el derecho a la seguridad jurídica",
          severity: "high",
          audit_classification: "VERIFIED_COURT_HOLDING",
        },
      ],
    });
    expect(result.answer).toMatch(/determinaciones judiciales|vía posterior/i);
    expect(result.answer).not.toMatch(/posición del cliente/i);
  });

  it("preserves the ordinary amparo objective when no court holding is present", () => {
    const result = buildObjectiveBlock({
      caseType: "amparo",
      locale: "es",
      documentsTotal: 1,
      findings: [{ title: "Acto reclamado identificado", severity: "medium" }],
    });
    expect(result.question).toMatch(/Procede el amparo/i);
  });
});
