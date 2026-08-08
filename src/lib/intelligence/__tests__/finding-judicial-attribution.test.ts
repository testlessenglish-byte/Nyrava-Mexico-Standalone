// Regression test reproducing the exact defect seen in a real report on
// ADR 5829/2025 (SCJN, Pleno): a finding sourced verbatim from the Tribunal
// Colegiado's ORIGINAL sentencia — the position the SCJN's ejecutoria itself
// revoked — rendered in the Executive Dashboard as a principal finding,
// indistinguishable from an adopted SCJN holding. This exercises the real
// projectCanonical() end-to-end (writer.server.ts + judicial-hierarchy.ts +
// findings-rank.server.ts), following this codebase's established fake-db
// testing convention (see ai-theory-exclusion.test.ts).
import { describe, it, expect } from "vitest";

function makeFakeDb(findingsRows: Array<Record<string, unknown>>) {
  return {
    from(table: string) {
      const chain = {
        eq(_col: string, _val: string) {
          return chain;
        },
        is(_col: string, _val: unknown) {
          return chain;
        },
        order(_col: string, _opts?: unknown) {
          return chain;
        },
        limit(_n: number) {
          return chain;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => void) => {
          if (table === "case_findings") {
            resolve({ data: findingsRows, error: null });
          } else {
            resolve({ data: [], error: null });
          }
        },
      };
      return {
        select(_cols: string) {
          return chain;
        },
        upsert(_payload: unknown) {
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

describe("projectCanonical: judicial-hierarchy attribution on a real precedent-review scenario", () => {
  it("keeps the Tribunal Colegiado's revoked holding out of Risks/Recommendations/top_findings; keeps the SCJN's adopted holding", async () => {
    const { projectCanonical } = await import("@/lib/canonical/writer.server");

    const rows = [
      // The bug, reproduced: same evidentiary quote the real report used,
      // but attributed to the Tribunal Colegiado's original sentencia —
      // the position ADR 5829/2025's Pleno ejecutoria expressly revoked.
      {
        id: "tc-exencion-federal-only",
        title: "Interpretación de la Exención Fiscal",
        description:
          "El Tribunal Colegiado sostuvo que la exención del artículo 230 de la LISSSTE únicamente resulta aplicable respecto de contribuciones de carácter federal.",
        category: "constitutional_rights_mapping",
        severity: "high",
        confidence: 1.0,
        finding_type: "DIRECT_EVIDENCE",
        finding_status: "verified",
        source_document_id: "doc-1",
        source_quote:
          "la exención prevista en el artículo 230 de la LISSSTE únicamente resulta aplicable respecto de contribuciones de carácter federal",
        evidence_refs: [{ doc_n: 1, quote: "la exención ... únicamente resulta aplicable ... federal" }],
        source_module: "engine:conventionality_pro_persona",
        speaker_role: "tribunal_colegiado",
        proposition_type: "rejected_holding",
        adoption_status: "rejected",
      },
      // The SCJN's actual adopted holding on the dispositive point.
      {
        id: "scjn-dominio-publico-exento",
        title: "Exención de bienes de dominio público destinados a servicio público de salud",
        description:
          "El Pleno de la SCJN determinó que los bienes del ISSSTE destinados al servicio público de salud están exentos del impuesto predial conforme al artículo 122 CPEUM.",
        category: "constitutional_rights_mapping",
        severity: "high",
        confidence: 0.95,
        finding_type: "DIRECT_EVIDENCE",
        finding_status: "verified",
        source_document_id: "doc-1",
        source_quote: "los inmuebles destinados a servicios que se relacionan directamente con la prestación del servicio público de salud ... deben estar excluidos de gravámenes locales",
        evidence_refs: [{ doc_n: 1, quote: "deben estar excluidos de gravámenes locales" }],
        source_module: "engine:constitutional_rights_mapping",
        speaker_role: "scjn",
        proposition_type: "holding",
        adoption_status: "adopted",
      },
    ];

    const analysis = await projectCanonical(makeFakeDb(rows) as never, "case-adr-5829", "FULL");

    // Both findings still exist in the record (nothing is deleted/hidden
    // from the full Findings/Hallazgos Clave section) —
    const findingIds = analysis.Findings.map((f) => f.id);
    expect(findingIds).toContain("tc-exencion-federal-only");
    expect(findingIds).toContain("scjn-dominio-publico-exento");

    // — but only the SCJN's adopted holding may reach the Executive
    // Dashboard: Risks, Recommendations, and ExecutiveSummary.top_findings.
    const riskIds = analysis.Risks.map((r) => r.id);
    const recIds = analysis.Recommendations.map((r) => r.id.replace(/^rec-/, ""));
    expect(riskIds).not.toContain("tc-exencion-federal-only");
    expect(riskIds).toContain("scjn-dominio-publico-exento");
    expect(recIds).not.toContain("tc-exencion-federal-only");
    expect(recIds).toContain("scjn-dominio-publico-exento");
    expect(analysis.ExecutiveSummary.top_findings).not.toContain("tc-exencion-federal-only");
    expect(analysis.ExecutiveSummary.top_findings).toContain("scjn-dominio-publico-exento");
  });

  it("does not change dashboard behavior for a case with no judicial-hierarchy attribution at all", async () => {
    const { projectCanonical } = await import("@/lib/canonical/writer.server");

    const rows = [
      {
        id: "civil-finding",
        title: "Incumplimiento contractual acreditado",
        description: "El demandado no realizó el pago pactado.",
        category: "key_legal_issue",
        severity: "high",
        confidence: 0.9,
        finding_type: "DIRECT_EVIDENCE",
        finding_status: "verified",
        source_document_id: "doc-1",
        source_quote: "no realizó el pago pactado",
        evidence_refs: [{ doc_n: 1, quote: "no realizó el pago pactado" }],
        source_module: "engine:generic",
        // No speaker_role / proposition_type / adoption_status — the
        // overwhelming majority of findings (non-precedent-review materias).
      },
    ];

    const analysis = await projectCanonical(makeFakeDb(rows) as never, "case-generic", "FULL");
    expect(analysis.Risks.map((r) => r.id)).toContain("civil-finding");
    expect(analysis.ExecutiveSummary.top_findings).toContain("civil-finding");
  });
});
