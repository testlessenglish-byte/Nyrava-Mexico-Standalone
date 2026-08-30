import { resolveReportGovernance } from "../intelligence/concluded-case-governance";
import { resolveReportCapability } from "../reporting/report-permissions";
import { describe, expect, it } from "vitest";
import {
  ATTORNEY_GROUPS,
  buildCaseSnapshot,
  buildExecutiveQuestions,
  buildFindingWorkProduct,
  classifyEvidenceWeight,
  groupForFinding,
} from "../reporting/attorney-workproduct";

const governance = resolveReportGovernance({case_analysis_mode:"ongoing"});
const ctx = {
  governance,
  capability: resolveReportCapability({report_mode:"FULL",scores_suppressed:false,motions_suppressed:false},governance),
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
    { canonical_source_id: "source-1", filename: "04_Dictamen_Grafoscopico.txt", quote: "la firma no corresponde" },
    { canonical_source_id: "source-2", filename: "13_Correos_y_WhatsApp_Supervisor.txt", quote: "ya no vendrá" },
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

// Regression test for a real, verified bug (ADR-2239-2018-180906 — SCJN
// First Chamber ruling that Article 75 of the Ley de Amparo IS
// constitutional): every finding correctly carried
// audit_classification: "VERIFIED_COURT_HOLDING", but groupForFinding()
// checked severity BEFORE checking that classification, so 4 favorable
// SCJN holdings landed in "Cuestiones Críticas" at ALTA-90/95% — the
// report inverted a favorable ruling into what looked like a critical
// risk. A holding is never risk-scored; it goes in its own section ahead
// of any risk analysis.
describe("groupForFinding: court holdings never enter the risk pipeline", () => {
  it("routes a VERIFIED_COURT_HOLDING to 'holdings' regardless of severity", () => {
    expect(
      groupForFinding({
        title: "Conformidad del artículo 75 de la Ley de Amparo con el derecho de acceso",
        category: "Procedencia del Amparo",
        severity: "high",
        confidence: 0.95,
        audit_classification: "VERIFIED_COURT_HOLDING",
      }),
    ).toBe("holdings");
  });

  it("still routes a genuine corpus gap normally — audit_classification null is a no-op", () => {
    expect(
      groupForFinding({
        title: "Elemento no identificado en el corpus: Interés jurídico o legítimo acreditado",
        description:
          "No se identificó una argumentación expresa sobre el interés jurídico en los documentos proporcionados. Esto refleja lo que consta en el corpus, no necesariamente una omisión en un escrito ya presentado.",
        category: "Procedencia del Amparo",
        severity: "high",
        confidence: 0.7,
        audit_classification: null,
      }),
    ).toBe("vacios");
  });

  it("does not sweep VERIFIED_LEGAL_RULE (a different classification) into holdings", () => {
    expect(
      groupForFinding({
        title: "Competencia de la autoridad",
        category: "Procedencia del Amparo",
        severity: "medium",
        audit_classification: "VERIFIED_LEGAL_RULE",
      }),
    ).toBe("procesales");
  });

  it("holdings is a real, declared group", () => {
    expect(ATTORNEY_GROUPS.map((g) => g.key)).toContain("holdings");
  });
});
