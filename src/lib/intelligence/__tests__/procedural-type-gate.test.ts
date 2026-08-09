// Regression tests for the procedural-type/absence-language fixes made
// after a real stress test on Amparo Directo en Revisión 3684/2012: the
// source gate (completed-case-audit) was working, but findings still used
// definitive absence language ("No se encontró...") and a ways_out_analysis
// remedy ("incidente de suspensión") was recommended with no verified legal
// authority attached. Both are now deterministic backstops in
// findings.server.ts, not prompt-only instructions — exercised here against
// the REAL exported functions.
import { describe, it, expect } from "vitest";
import {
  enforceCorpusBoundedAbsenceLanguage,
  enforceRemedyLegalAuthorityGate,
  normalizeLlmFindings,
} from "@/lib/intelligence/findings.server";

describe("enforceCorpusBoundedAbsenceLanguage", () => {
  it("rewrites a definitive Spanish absence claim to corpus-bounded phrasing, preserving the rest of the sentence", () => {
    const text =
      "No se encontró referencia a la presentación de alegatos adicionales que pudieran ser impugnados.";
    expect(enforceCorpusBoundedAbsenceLanguage(text)).toBe(
      "No se identificó en el corpus/documentos analizados referencia a la presentación de alegatos adicionales que pudieran ser impugnados.",
    );
  });

  it("rewrites the English equivalent", () => {
    expect(
      enforceCorpusBoundedAbsenceLanguage("No evidence was found of service of process."),
    ).toBe("The corpus/documents reviewed do not identify service of process.");
  });

  it("leaves ordinary (non-absence) findings untouched", () => {
    const text = "El juzgador valoró la hipótesis propuesta por el acusador.";
    expect(enforceCorpusBoundedAbsenceLanguage(text)).toBe(text);
  });

  it("is a no-op on empty text", () => {
    expect(enforceCorpusBoundedAbsenceLanguage("")).toBe("");
  });
});

describe("normalizeLlmFindings: absence language is rewritten at the single normalization choke point", () => {
  it("rewrites both title and description when the LLM phrases an absence finding definitively", () => {
    const rows = normalizeLlmFindings({
      caseId: "case-1",
      userId: "user-1",
      sourceModule: "agent:ways_out_analysis",
      defaultCategory: "ways_out_analysis",
      items: [
        {
          title: "No se encontró referencia a una solicitud de ampliación de la demanda de amparo.",
          description:
            "No se encontró referencia a una solicitud de ampliación de la demanda de amparo.",
          audit_classification: "NOT_FOUND",
        },
      ],
    });
    expect(rows[0].title).toMatch(/^No se identificó en el corpus\/documentos analizados/);
    expect(rows[0].description).toMatch(/^No se identificó en el corpus\/documentos analizados/);
    expect(rows[0].title).not.toMatch(/^No se encontró/);
  });
});

describe("enforceRemedyLegalAuthorityGate: procedural recommendations require verified legal authority, not just facts", () => {
  it("downgrades a remedy proposal with no legal_authority to EVIDENCE_GAP and appends a verification caveat — the real incidente de suspensión case", () => {
    const rows = normalizeLlmFindings({
      caseId: "case-1",
      userId: "user-1",
      sourceModule: "agent:ways_out_analysis",
      defaultCategory: "ways_out_analysis",
      items: [
        {
          title:
            "El expediente menciona que el juzgador evalúa la hipótesis propuesta por el acusador en relación con las hipótesis alternativas defensivas, lo que podría justificar la interposición de un incidente de suspensión.",
          description:
            "El expediente menciona que el juzgador evalúa la hipótesis propuesta por el acusador en relación con las hipótesis alternativas defensivas, lo que podría justificar la interposición de un incidente de suspensión.",
          remedy_type: "incidente_de_suspension",
          evidence_refs: [{ doc_n: "3684/2012", quote: "la hipótesis propuesta por el acusador" }],
          audit_classification: "POTENTIAL_ISSUE",
          // legal_authority intentionally absent — this is the real bug.
        },
      ],
    });

    const gated = enforceRemedyLegalAuthorityGate(rows, "es");
    expect(gated[0].audit_classification).toBe("EVIDENCE_GAP");
    expect(gated[0].description).toMatch(/REQUIERE VERIFICACIÓN/);
    expect(gated[0].description).toMatch(/autoridad legal aplicable a esta etapa procesal/);
  });

  it("does NOT downgrade a remedy proposal that carries a real, independently-stated legal authority", () => {
    const rows = normalizeLlmFindings({
      caseId: "case-1",
      userId: "user-1",
      sourceModule: "agent:ways_out_analysis",
      defaultCategory: "ways_out_analysis",
      items: [
        {
          title: "Posible recurso de reclamación contra el acuerdo de trámite.",
          description: "Posible recurso de reclamación contra el acuerdo de trámite.",
          remedy_type: "recurso_de_reclamacion",
          evidence_refs: [{ doc_n: "3684/2012", quote: "acuerdo de trámite impugnado" }],
          audit_classification: "POTENTIAL_ISSUE",
          legal_authority:
            "Artículo 104 de la Ley de Amparo (recurso de reclamación contra acuerdos de trámite).",
        },
      ],
    });

    const gated = enforceRemedyLegalAuthorityGate(rows, "es");
    expect(gated[0].audit_classification).toBe("POTENTIAL_ISSUE");
    expect(gated[0].description).not.toMatch(/REQUIERE VERIFICACIÓN/);
  });

  it("leaves NOT_FOUND/EVIDENCE_GAP rows and non-remedy findings from other modules untouched", () => {
    const rows = normalizeLlmFindings({
      caseId: "case-1",
      userId: "user-1",
      sourceModule: "agent:ways_out_analysis",
      defaultCategory: "ways_out_analysis",
      items: [
        {
          title: "No se identificó base para una vía de impugnación adicional.",
          description: "No se identificó base para una vía de impugnación adicional.",
          audit_classification: "NOT_FOUND",
        },
      ],
    });
    const otherModuleRows = normalizeLlmFindings({
      caseId: "case-1",
      userId: "user-1",
      sourceModule: "analyzer:constitutional_issues",
      defaultCategory: "constitutional",
      items: [{ title: "Cuestión constitucional identificada.", description: "Detalle." }],
    });

    const gated = enforceRemedyLegalAuthorityGate([...rows, ...otherModuleRows], "es");
    expect(gated[0].audit_classification).toBe("NOT_FOUND");
    expect(gated[0].description).not.toMatch(/REQUIERE VERIFICACIÓN/);
    expect(gated[1].description).not.toMatch(/REQUIERE VERIFICACIÓN/);
  });
});
