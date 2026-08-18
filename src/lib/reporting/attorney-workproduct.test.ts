import { describe, expect, it } from "vitest";
import {
  buildCaseSnapshot,
  buildExecutiveQuestions,
  classifyEvidenceWeight,
} from "./attorney-workproduct";

describe("attorney work-product evidence classification", () => {
  it("does not falsely claim that no judicial resolution exists when a generic filename cannot be classified", () => {
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