import { describe, expect, it } from "vitest";
import {
  buildCaseSnapshot,
  buildExecutiveQuestions,
  buildFindingWorkProduct,
  classifyEvidenceWeight,
} from "./attorney-workproduct";

describe("attorney work-product evidence classification", () => {
  it("does not falsely claim that no judicial resolution exists when a generic filename cannot be classified without provenance", () => {
    const ctx = {
      documentLabels: ["ADR-4640-2017-180212.pdf"],
      caseType: "amparo",
      jurisdiction: "federal",
    };
    const snapshot = buildCaseSnapshot([], ctx);
    expect(snapshot.criticalEvidence).toEqual([]);
    const questions = buildExecutiveQuestions([], ctx, snapshot);
    const strongest = questions.find((q) => q.question === "¿Cuál es la evidencia más sólida?");
    expect(strongest?.answer).toContain("clasificación documental");
    expect(strongest?.answer).toContain("no significa que no existan resoluciones judiciales");
  });

  it("resolves a verified court holding to the sole uploaded source even when evidence_refs omit the filename", () => {
    const ctx = {
      documentLabels: ["ADR-4640-2017-180212.pdf"],
      caseType: "amparo",
      jurisdiction: "federal",
    };
    const finding = {
      title: "No se vulnera el derecho a la seguridad jurídica",
      audit_classification: "VERIFIED_COURT_HOLDING",
      source_document_id: "doc-1",
      source_quote: "el precepto impugnado no presenta el vicio de inconstitucionalidad",
      evidence_refs: [
        { doc_n: 1, quote: "el precepto impugnado no presenta el vicio de inconstitucionalidad" },
      ],
      confidence: 0.9,
      severity: "medium",
    };
    const wp = buildFindingWorkProduct(finding, ctx);
    expect(wp.synthesis?.docs[0].name).toBe("ADR-4640-2017-180212.pdf");
    expect(wp.synthesis?.docs[0].weight.label).toBe("Resolución Judicial");

    const snapshot = buildCaseSnapshot([finding], ctx);
    expect(snapshot.criticalEvidence[0]).toContain("Resolución Judicial");
    expect(snapshot.criticalEvidence[0]).toContain("ADR-4640-2017-180212.pdf");
  });

  it("continues to classify explicit judicial-resolution filenames at the highest tier", () => {
    const weight = classifyEvidenceWeight("Sentencia ejecutoria SCJN.pdf");
    expect(weight.label).toBe("Resolución Judicial");
    expect(weight.stars).toBe(5);
  });

  it("does not promote an unrelated generic document merely because it is a PDF", () => {
    const weight = classifyEvidenceWeight("documento-001.pdf");
    expect(weight.label).toBe("Documento Sin Clasificar");
    expect(weight.stars).toBe(2);
  });
});