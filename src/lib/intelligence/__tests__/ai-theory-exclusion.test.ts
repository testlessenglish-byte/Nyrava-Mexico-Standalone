// Regression test for PR A item 4 (report-truthfulness audit): an AI_THEORY
// finding must not render like a verified finding in the final report.
// Confirmed via a real production case where the only findings that
// survived to scoring were AI_THEORY "missing element" placeholders with
// zero evidence_refs — they appeared in the report indistinguishably from
// grounded findings, contributing to Hallazgos Clave / verified-finding
// counts / narrative.
//
// audit B8 (stale test): this file originally asserted AI_THEORY findings
// are dropped from `analysis.Findings` entirely. writer.server.ts's actual,
// deliberate design (see its own detailed comment above `isAiTheory`) is
// narrower and documented: AI_THEORY findings ARE kept in Findings —
// visibly labeled "[IA — teoría no verificada]" so nothing is silently
// hidden from the attorney — and are excluded only from the places that
// would present them as VERIFIED: Evidence, Risks, and Recommendations.
// Updated to assert the real, current (and more precise) contract instead
// of the stale one.
//
// This exercises the real exported projectCanonical() function directly
// with a generic fake db (following this codebase's established mocking
// convention — see engine-persistence.test.ts, regression-harness.test.ts).
// No case-specific content — synthetic findings of both types.
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

describe("projectCanonical: AI_THEORY findings labeled and kept out of verified surfaces", () => {
  it("keeps a labeled AI_THEORY finding in Findings but excludes it from Risks, alongside a grounded DIRECT_EVIDENCE finding", async () => {
    const { projectCanonical } = await import("@/lib/canonical/writer.server");

    const rows = [
      {
        id: "finding-grounded",
        title: "Documented delivery date",
        description: "Generic grounded finding.",
        category: "documentary_fact",
        severity: "medium",
        confidence: 0.9,
        finding_type: "DIRECT_EVIDENCE",
        finding_status: "verified",
        source_document_id: "doc-1",
        source_quote: "some verbatim text",
        evidence_refs: [{ doc_n: 1, quote: "some verbatim text" }],
        source_module: "engine:generic",
      },
      {
        id: "finding-ai-theory",
        title: "Elemento no identificado en el corpus: Requisito genérico",
        description: "No se identificó evidencia del requisito en los documentos proporcionados.",
        category: "cumplimiento_procesal",
        severity: "high",
        confidence: 0.7,
        finding_type: "AI_THEORY",
        finding_status: "candidate",
        source_document_id: null,
        source_quote: null,
        evidence_refs: [],
        source_module: "engine:procedural_compliance",
      },
    ];

    const analysis = await projectCanonical(makeFakeDb(rows) as never, "case-generic", "LIMITED");

    // Both findings are visible in Findings — the AI_THEORY one is never
    // silently hidden — but it's clearly labeled as unverified.
    const ids = analysis.Findings.map((f) => f.id);
    expect(ids).toContain("finding-grounded");
    expect(ids).toContain("finding-ai-theory");
    expect(analysis.Findings).toHaveLength(2);
    const theoryFinding = analysis.Findings.find((f) => f.id === "finding-ai-theory");
    expect(theoryFinding?.title).toContain("[IA — teoría no verificada]");

    // The high-severity AI_THEORY finding must never surface as a Risk —
    // that would present an unverified theory as a confirmed problem.
    expect(analysis.Risks.some((r) => r.id === "finding-ai-theory")).toBe(false);
  });

  it("with only an AI_THEORY finding present, it is labeled in Findings but produces no Risks (no false-positive count)", async () => {
    const { projectCanonical } = await import("@/lib/canonical/writer.server");

    const rows = [
      {
        id: "finding-ai-theory-only",
        title: "Elemento no identificado en el corpus: Otro requisito",
        description: "No se identificó evidencia en los documentos proporcionados.",
        category: "cumplimiento_procesal",
        severity: "high",
        confidence: 0.7,
        finding_type: "AI_THEORY",
        finding_status: "candidate",
        source_document_id: null,
        source_quote: null,
        evidence_refs: [],
        source_module: "engine:procedural_compliance",
      },
    ];

    const analysis = await projectCanonical(makeFakeDb(rows) as never, "case-generic", "LIMITED");
    expect(analysis.Findings).toHaveLength(1);
    expect(analysis.Findings[0].title).toContain("[IA — teoría no verificada]");
    expect(analysis.Risks).toHaveLength(0);
  });
});
