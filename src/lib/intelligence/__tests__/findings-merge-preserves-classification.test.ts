// Regression test for a real bug found via a live case export (ADR-4640-
// 2017-180212, case_analysis_mode=appeal_routes): the ways_out_analysis
// agent's LLM output correctly included audit_classification (visible in
// case_findings.metadata.raw.audit_classification = "POTENTIAL_ISSUE"), but
// the persisted top-level audit_classification column stayed null.
//
// Root cause: when a freshly-generated finding collides (same category +
// normalized title) with an ALREADY-PERSISTED row from earlier in the same
// run, dedupSemantically() in findings.server.ts always picks the existing
// row (represented by a minimal "existingShim" object) as the merge winner
// so downstream references keep pointing at its id — but existingShim never
// carries speaker_role/proposition_type/adoption_status/audit_classification
// (see its construction in addFindings), so spreading `...winner` discarded
// these fields from the loser (the fresh finding) even when the loser had a
// real value and the winner didn't. The merge-into-existing UPDATE call
// then never wrote them either, since its payload never listed those
// columns at all. This exercises the REAL addFindings() end-to-end with a
// fake db seeded with one pre-existing row that collides with an incoming
// finding carrying a real audit_classification, and asserts the UPDATE
// payload actually carries it through.
import { describe, it, expect } from "vitest";

const QUOTE = "constituyen un argumento novedoso que al no haber sido planteado desde la demanda de amparo no procede su estudio";

function makeFakeDb(updateCalls: Array<{ id: unknown; payload: Record<string, unknown> }>) {
  function chain(resolveValue: unknown) {
    const c: Record<string, unknown> = {
      eq: () => c,
      not: () => c,
      like: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: async () => ({ data: resolveValue, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: resolveValue, error: null }),
    };
    return c;
  }
  return {
    from(table: string) {
      return {
        select() {
          if (table === "cases") return chain({ case_type: "amparo", analysis_mode: "exploratory" });
          if (table === "documents")
            return chain([{ id: "doc-1", filename: "doc-1.txt", extracted_text: QUOTE, status: "extracted" }]);
          if (table === "case_domain_activations") return chain([]);
          if (table === "case_findings")
            return chain([
              {
                id: "existing-row-1",
                category: "ways_out_analysis",
                title: "Argumento novedoso no estudiado",
                evidence_refs: [{ doc_n: 1, quote: QUOTE }],
                confidence: 0.6,
                source_doc_ids: ["doc-1"],
                metadata: {},
              },
            ]);
          return chain([]);
        },
        insert(payload: unknown) {
          const rows = Array.isArray(payload) ? payload : [payload];
          return { select: () => ({ then: (r: (v: unknown) => void) => r({ data: rows, error: null }) }) };
        },
        update(payload: Record<string, unknown>) {
          return {
            eq: (_col: string, id: unknown) => {
              updateCalls.push({ id, payload });
              return Promise.resolve({ error: null });
            },
          };
        },
        delete: () => ({ eq: () => ({ like: () => Promise.resolve({ error: null }) }) }),
      };
    },
  };
}

describe("addFindings: merging into an existing row preserves audit_classification", () => {
  it("carries a fresh finding's audit_classification through to the merge-into-existing UPDATE", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const updateCalls: Array<{ id: unknown; payload: Record<string, unknown> }> = [];
    const db = makeFakeDb(updateCalls);

    const rows = [
      {
        case_id: "case-1",
        user_id: "user-1",
        source_module: "agent:ways_out_analysis",
        category: "ways_out_analysis",
        title: "Argumento novedoso no estudiado",
        description: "El quejoso alega una violación no planteada en la demanda de amparo.",
        severity: "low" as const,
        confidence: 0.9,
        legal_significance: null,
        potential_impact: null,
        affected_party: null,
        audit_classification: "VERIFIED_COURT_HOLDING" as const,
        evidence_refs: [{ doc_n: 1, quote: QUOTE }],
        source_doc_ids: ["doc-1"],
        tags: [],
        metadata: {},
      },
    ];

    await addFindings(db as never, rows);

    expect(updateCalls.length).toBeGreaterThan(0);
    const call = updateCalls[0];
    expect(call.id).toBe("existing-row-1");
    expect(call.payload.audit_classification).toBe("VERIFIED_COURT_HOLDING");
  });
});
