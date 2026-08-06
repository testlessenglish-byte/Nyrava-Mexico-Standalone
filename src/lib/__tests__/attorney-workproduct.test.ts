import { describe, expect, it } from "vitest";
import {
  ATTORNEY_GROUPS,
  buildCaseSnapshot,
  buildExecutiveQuestions,
  buildFindingWorkProduct,
  classifyEvidenceWeight,
  groupForFinding,
} from "../reporting/attorney-workproduct";

const ctx = {
  documentLabels: [
    "04_Dictamen_Grafoscopico.txt",
    "13_Correos_y_WhatsApp_Supervisor.txt",
    "05_Acta_Audiencia_Juicio.txt",
  ],
  caseType: "laboral",
  missingDocuments: [],
};

const finding = {
  title: "La renuncia fue objetada y desvirtuada",
  description: "El dictamen pericial concluye que la firma no corresponde a la actora.",
  category: "contradiccion",
  severity: "critical",
  confidence: 0.9,
  legal_significance: "Incide directamente en la existencia del despido.",
  evidence_refs: [
    { filename: "04_Dictamen_Grafoscopico.txt", quote: "la firma no corresponde" },
    { filename: "13_Correos_y_WhatsApp_Supervisor.txt", quote: "ya no vendrá" },
  ],
};

describe("attorney work product", () => {
  it("classifies Mexican evidentiary weight tiers", () => {
    expect(classifyEvidenceWeight("Sentencia definitiva").stars).toBe(5);
    expect(classifyEvidenceWeight("Dictamen pericial en grafoscopía").label).toBe(
      "Dictamen Pericial",
    );
    expect(classifyEvidenceWeight("WhatsApp supervisor").stars).toBe(2);
    expect(classifyEvidenceWeight("Testimonial de compañeros").stars).toBe(1);
  });

  it("produces 2-4 importance paragraphs, synthesis and 3-7 actions", () => {
    const wp = buildFindingWorkProduct(finding, ctx);
    expect(wp.importance.length).toBeGreaterThanOrEqual(2);
    expect(wp.importance.length).toBeLessThanOrEqual(4);
    expect(wp.actions.length).toBeGreaterThanOrEqual(3);
    expect(wp.actions.length).toBeLessThanOrEqual(7);
    expect(wp.synthesis?.docs[0].weight.label).toBe("Dictamen Pericial");
    expect(wp.synthesis?.narrative).toContain("2 documentos");
  });

  it("flags single-source findings for professional review", () => {
    const wp = buildFindingWorkProduct(
      { ...finding, evidence_refs: [finding.evidence_refs[0]] },
      ctx,
    );
    expect(wp.importance.join(" ")).toContain("revisión profesional");
    expect(wp.actions.join(" ")).toContain("corrobore");
  });

  it("groups findings into attorney review categories", () => {
    expect(ATTORNEY_GROUPS.map((g) => g.key)).toContain(groupForFinding(finding));
    expect(groupForFinding({ category: "plazo procesal", severity: "medium" })).toBe("procesales");
  });

  it("builds a snapshot and the five executive questions", () => {
    const snapshot = buildCaseSnapshot([finding], ctx);
    expect(snapshot.priorityReview.length).toBe(1);
    const qs = buildExecutiveQuestions([finding], ctx, snapshot);
    expect(qs).toHaveLength(5);
    expect(qs[0].answer).toContain("materia laboral");
  });

  it("never invents missing evidence outside the inventory", () => {
    const wp = buildFindingWorkProduct(finding, { ...ctx, documentLabels: [] });
    expect(wp.pending.every((p) => p.startsWith("No"))).toBe(true);
  });
});
