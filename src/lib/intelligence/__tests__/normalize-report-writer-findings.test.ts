// Canonical Reconciliation Design (2026-08-16), P0 — converter unit tests
// for normalizeReportWriterFindings, the bridge that lets the report-
// writer's own "intelligence" chunk (contradictions/missing_evidence/
// constitutional_issues — see intelShape in pipeline.server.ts) flow
// through addGatedFindings like every other producer.
import { describe, it, expect } from "vitest";
import { normalizeReportWriterFindings } from "../findings.server";

describe("normalizeReportWriterFindings", () => {
  const docNToId = new Map<number, string | null>([
    [1, "doc-uuid-1"],
    [2, "doc-uuid-2"],
  ]);

  it("converts a contradiction item, resolving doc_n to real document ids", () => {
    const { contradictionRows } = normalizeReportWriterFindings({
      caseId: "case-1",
      userId: "user-1",
      contradictions: [
        {
          title: "Fechas de notificación en conflicto",
          document_a: { doc_n: 1, page: 3, quote: "Notificado el 5 de enero de 2025." },
          document_b: { doc_n: 2, page: 7, quote: "Notificado el 12 de enero de 2025." },
          nature: "date_conflict",
          severity: "high",
          legal_impact: "Afecta el cómputo del plazo procesal.",
          side_helped: "defense",
        },
      ],
      missingEvidence: [],
      constitutionalIssues: [],
      docNToId,
    });

    expect(contradictionRows).toHaveLength(1);
    const row = contradictionRows[0];
    expect(row.source_module).toBe("report_writer:contradiction");
    expect(row.category).toBe("contradiction");
    expect(row.title).toBe("Fechas de notificación en conflicto");
    expect(row.severity).toBe("high");
    expect(row.affected_party).toBe("defense");
    expect(row.evidence_refs).toHaveLength(2);
    expect(row.source_doc_ids?.sort()).toEqual(["doc-uuid-1", "doc-uuid-2"]);
  });

  it("marks missing-evidence rows with the full domain token and no citation requirement", () => {
    const { missingEvidenceRows } = normalizeReportWriterFindings({
      caseId: "case-1",
      userId: "user-1",
      contradictions: [],
      missingEvidence: [
        {
          item: "Acta de notificación personal",
          why_critical: "Sin ella no puede acreditarse el inicio del plazo.",
          severity: "medium",
          side_harmed: "quejoso",
        },
      ],
      constitutionalIssues: [],
      docNToId,
    });

    expect(missingEvidenceRows).toHaveLength(1);
    const row = missingEvidenceRows[0];
    expect(row.source_module).toBe("report_writer:missing_evidence");
    expect(row.category).toBe("missing_evidence");
    expect(row.evidence_refs).toEqual([]);
  });

  it("converts a constitutional-issue item with a full-token source_module", () => {
    const { constitutionalRows } = normalizeReportWriterFindings({
      caseId: "case-1",
      userId: "user-1",
      contradictions: [],
      missingEvidence: [],
      constitutionalIssues: [
        {
          right: "Debido proceso",
          articulo_cpeum: "Art. 14 CPEUM",
          issue: "Falta de notificación oportuna",
          facts: "El acuerdo se notificó fuera del plazo legal.",
          citations: [{ doc_n: 1, page: 2, quote: "El acuerdo se notificó fuera del plazo legal." }],
        },
      ],
      docNToId,
    });

    expect(constitutionalRows).toHaveLength(1);
    const row = constitutionalRows[0];
    expect(row.source_module).toBe("report_writer:constitutional_issue");
    expect(row.category).toBe("constitutional_issue");
    expect(row.legal_significance).toContain("Art. 14 CPEUM");
    expect(row.source_doc_ids).toEqual(["doc-uuid-1"]);
  });

  it("drops citations with no quote text instead of producing empty evidence_refs entries", () => {
    const { contradictionRows } = normalizeReportWriterFindings({
      caseId: "case-1",
      userId: "user-1",
      contradictions: [
        {
          title: "x",
          document_a: { doc_n: 1, page: 1, quote: "" },
          document_b: undefined,
          citations: [{ doc_n: 2, page: 1, quote: "Real quote here." }],
        },
      ],
      missingEvidence: [],
      constitutionalIssues: [],
      docNToId,
    });
    expect(contradictionRows[0].evidence_refs).toHaveLength(1);
    expect((contradictionRows[0].evidence_refs?.[0] as { quote?: string }).quote).toBe(
      "Real quote here.",
    );
  });

  // P2 (2026-08-16) — the 4 fields P0 left untouched from the same
  // intelShape chunk.
  it("converts a motion_opportunity item, mapping likelihood_of_success to severity", () => {
    const { motionOpportunityRows } = normalizeReportWriterFindings({
      caseId: "case-1",
      userId: "user-1",
      contradictions: [],
      missingEvidence: [],
      constitutionalIssues: [],
      motionOpportunities: [
        {
          motion: "Incidente de nulidad de notificaciones",
          basis: "Art. 26 Ley de Amparo",
          legal_rationale: "La notificación se practicó en domicilio distinto al señalado.",
          likelihood_of_success: "high",
          citations: [{ doc_n: 1, page: 2, quote: "Domicilio distinto al señalado por el quejoso." }],
        },
      ],
      docNToId,
    });
    expect(motionOpportunityRows).toHaveLength(1);
    const row = motionOpportunityRows[0];
    expect(row.source_module).toBe("report_writer:motion_opportunity");
    expect(row.category).toBe("motion_opportunity");
    expect(row.severity).toBe("high");
    expect(row.evidence_refs).toHaveLength(1);
  });

  it("converts strategy_recommendation/next_action/cross_examination items with no evidence_refs requirement", () => {
    const result = normalizeReportWriterFindings({
      caseId: "case-1",
      userId: "user-1",
      contradictions: [],
      missingEvidence: [],
      constitutionalIssues: [],
      strategyRecommendations: [
        { title: "Solicitar peritaje en criminalística", rationale: "Corrobora la cadena de custodia.", priority: "high" },
      ],
      nextActions: [{ action: "Recabar acta de notificación", why: "Falta en el expediente." }],
      crossExamination: [
        {
          witness: "Juan Pérez",
          objective: "Impugnar credibilidad del testigo.",
          lines: [{ topic: "Ubicación", questions: ["¿Dónde se encontraba?"], citation: null }],
        },
      ],
      docNToId,
    });

    expect(result.strategyRecommendationRows).toHaveLength(1);
    expect(result.strategyRecommendationRows[0].source_module).toBe(
      "report_writer:strategy_recommendation",
    );
    expect(result.strategyRecommendationRows[0].severity).toBe("high");

    expect(result.nextActionRows).toHaveLength(1);
    expect(result.nextActionRows[0].source_module).toBe("report_writer:next_action");
    expect(result.nextActionRows[0].title).toBe("Recabar acta de notificación");

    expect(result.crossExaminationRows).toHaveLength(1);
    expect(result.crossExaminationRows[0].source_module).toBe("report_writer:cross_examination");
    expect(result.crossExaminationRows[0].title).toContain("Juan Pérez");
  });

  it("returns empty arrays for the 4 new fields when omitted (backward compatible with the P0 call shape)", () => {
    const result = normalizeReportWriterFindings({
      caseId: "case-1",
      userId: "user-1",
      contradictions: [],
      missingEvidence: [],
      constitutionalIssues: [],
      docNToId,
    });
    expect(result.motionOpportunityRows).toEqual([]);
    expect(result.strategyRecommendationRows).toEqual([]);
    expect(result.nextActionRows).toEqual([]);
    expect(result.crossExaminationRows).toEqual([]);
  });
});
