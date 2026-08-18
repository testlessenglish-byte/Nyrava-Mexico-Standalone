import { describe, expect, it } from "vitest";
import { buildCanonicalReportContext, sanitizeNarrativeProse } from "../report-canonical-context";

describe("canonical narrative integrity guards", () => {
  it("removes free-prose legal filing advice before the final report merge", () => {
    const parsed = {
      prose: {
        executive_summary:
          "La SCJN declaró inoperante el agravio. Se recomienda presentar un recurso de revisión ante el Tribunal Colegiado de Circuito.",
        recommendations: "Presentar un recurso de revisión ante el Tribunal Colegiado de Circuito.",
      },
    };
    const result = sanitizeNarrativeProse(parsed);
    expect(result.filingSentencesRemoved).toBeGreaterThan(0);
    expect(parsed.prose.executive_summary).not.toMatch(/presentar un recurso/i);
    expect(parsed.prose.recommendations).toBe("");
  });

  it("does not convert a corpus evidence gap into an affirmative absence fact", () => {
    const parsed = {
      prose: {
        missing_evidence_report:
          "No se presenta evidencia de que se haya notificado al quejoso sobre la resolución.",
        executive_summary:
          "La debilidad principal radica en la falta de notificación de la resolución al quejoso. La SCJN analizó la constitucionalidad del precepto.",
      },
    };
    const result = sanitizeNarrativeProse(parsed);
    expect(result.absenceInversionsRemoved).toBe(1);
    expect(parsed.prose.executive_summary).not.toMatch(/falta de notificación/i);
    expect(parsed.prose.executive_summary).toMatch(/SCJN analizó/i);
    expect(parsed.prose.missing_evidence_report).toMatch(/No se presenta evidencia/i);
  });

  it("does not label a single legal holding as a contradiction", () => {
    const parsed = {
      prose: {
        contradiction_report:
          "Una contradicción significativa se presenta en la inoperancia de los agravios novedosos [DOC 1 p.4]. El tribunal declaró inoperante el argumento novedoso [DOC 1 p.4].",
      },
    };
    const result = sanitizeNarrativeProse(parsed);
    expect(result.unsupportedContradictionsRemoved).toBe(1);
    expect(parsed.prose.contradiction_report).not.toMatch(/contradicción significativa/i);
    expect(parsed.prose.contradiction_report).toMatch(/declaró inoperante/i);
  });

  it("keeps an explicit two-sided contradiction statement", () => {
    const parsed = {
      prose: {
        contradiction_report:
          "El documento A afirma el pago [DOC 1 p.2], mientras que el documento B niega su recepción [DOC 2 p.4]; existe una contradicción que requiere revisión.",
      },
    };
    const result = sanitizeNarrativeProse(parsed);
    expect(result.unsupportedContradictionsRemoved).toBe(0);
    expect(parsed.prose.contradiction_report).toMatch(/contradicción/i);
  });

  it("sanitizes the same object later consumed by canonical context", () => {
    const parsed = {
      prose: {
        executive_summary: "Se recomienda interponer recurso de revisión. La resolución declaró inoperante el agravio.",
        recommendations: "Se recomienda interponer recurso de revisión.",
      },
    };
    const context = buildCanonicalReportContext(parsed);
    expect(context.executiveSummary).not.toMatch(/interponer recurso/i);
    expect(context.executiveSummary).toMatch(/declaró inoperante/i);
    expect(context.recommendations).toHaveLength(0);
  });
});
