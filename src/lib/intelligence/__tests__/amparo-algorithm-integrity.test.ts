import { describe, expect, it } from "vitest";
import { assessRisk, detectMotions, runAlgorithmBundle } from "../algorithms";
import { consolidateFindings } from "../finding-dedupe";

describe("Amparo / cross-materia deterministic algorithm integrity", () => {
  it("does not turn constitutional analysis count into adverse risk by itself", () => {
    const risk = assessRisk({
      unresolved_contradictions: 0,
      missing_evidence: 0,
      constitutional_issues: 8,
      unfavorable_witnesses: 0,
      procedural_defects: 0,
    });
    expect(risk.score).toBe(0);
    expect(risk.band).toBe("low");
    expect(risk.factors.some((f) => /constitutional/i.test(f.label))).toBe(false);
  });

  it("does not manufacture a CNPP discovery motion from a generic missing-evidence signal", () => {
    expect(
      detectMotions([{ tag: "descubrimiento_probatorio_incompleto", severity: "high" }]),
    ).toEqual([]);
  });

  it("still allows the penal discovery remedy when penal context is independently established", () => {
    const motions = detectMotions([
      { tag: "descubrimiento_probatorio_incompleto", severity: "high" },
      { tag: "cadena_custodia_rota", severity: "high" },
    ]);
    expect(motions.some((m) => /descubrimiento probatorio complementario/i.test(m.motion))).toBe(true);
    expect(motions.some((m) => /cadena de custodia/i.test(m.motion))).toBe(true);
  });

  it("does not manufacture a generic nulidad motion from two materia-neutral defects alone", () => {
    expect(
      detectMotions([
        { tag: "defecto_procesal", severity: "high" },
        { tag: "defecto_procesal", severity: "medium" },
      ]),
    ).toEqual([]);
  });

  it("keeps the same protections when algorithms run through the report bundle", () => {
    const bundle = runAlgorithmBundle({
      risk: {
        unresolved_contradictions: 0,
        missing_evidence: 0,
        constitutional_issues: 5,
        unfavorable_witnesses: 0,
        procedural_defects: 0,
      },
      motionSignals: [{ tag: "descubrimiento_probatorio_incompleto", severity: "critical" }],
    });
    expect(bundle.risk?.score).toBe(0);
    expect(bundle.motions).toEqual([]);
  });
});

describe("court holding versus speculative duplicate", () => {
  const quote =
    "Esta Primera Sala determina la inconstitucionalidad de la fracción IV del artículo 470 del Código Nacional de Procedimientos Penales.";

  it("keeps the verified court holding and merges the speculative restatement into it", () => {
    const out = consolidateFindings([
      {
        id: "holding",
        category: "constitucional",
        title: "Inconstitucionalidad de la fracción IV del artículo 470",
        description: "La SCJN declaró inconstitucional la disposición.",
        audit_classification: "VERIFIED_COURT_HOLDING",
        severity: "medium",
        confidence: 0.84,
        evidence_refs: [{ doc_id: "scjn-4321", quote }],
      },
      {
        id: "possible",
        category: "constitutional_issue",
        title: "Posible inconstitucionalidad del artículo 470 del CNPP",
        description: "Podría existir una cuestión de constitucionalidad.",
        audit_classification: "POTENTIAL_ISSUE",
        severity: "critical",
        confidence: 0.96,
        evidence_refs: [{ doc_id: "scjn-4321", quote }],
      },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("holding");
    expect(out[0].audit_classification).toBe("VERIFIED_COURT_HOLDING");
    expect(out[0]._alias_ids).toContain("possible");
  });

  it("does not merge an unrelated potential issue just because it came from the same judgment", () => {
    const out = consolidateFindings([
      {
        id: "holding",
        category: "constitucional",
        title: "Inconstitucionalidad de la fracción IV del artículo 470",
        audit_classification: "VERIFIED_COURT_HOLDING",
        evidence_refs: [{ doc_id: "scjn-4321", quote }],
      },
      {
        id: "other",
        category: "constitutional_issue",
        title: "Posible omisión de estudio de un agravio distinto",
        audit_classification: "POTENTIAL_ISSUE",
        evidence_refs: [{ doc_id: "scjn-4321", quote: "El recurrente formuló un agravio diverso sobre competencia." }],
      },
    ]);
    expect(out).toHaveLength(2);
  });
});
