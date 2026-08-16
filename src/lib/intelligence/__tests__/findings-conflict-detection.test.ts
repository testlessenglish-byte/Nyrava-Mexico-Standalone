// Canonical Reconciliation Design (2026-08-16), P0 — real ADR-5829/2025-
// shaped regression: the analyzer's contradiction pass already persisted a
// finding affirmatively concluding "no existe contradicción" for a claim;
// the report-writer's own intelligence chunk (now routed through
// addGatedFindings via normalizeReportWriterFindings, closing the bypass)
// produces a fresh finding on the SAME claim affirmatively concluding the
// opposite. Before this fix, dedupSemantically's existing-row merge would
// have silently picked one side (severity-winner) and discarded the other
// via merged_from, with no record a disagreement ever existed. This
// exercises the REAL addFindings() end-to-end with a fake db seeded with
// the pre-existing analyzer row, and asserts the merge-into-existing UPDATE
// carries reconciliation_state="unresolved" + metadata.conflict instead.
import { describe, it, expect } from "vitest";

const QUOTE_A =
  "El acuerdo de admisión fue debidamente notificado conforme al artículo 230 de la LISSSTE.";
const QUOTE_B = "La resolución impugnada desconoce el acuerdo de admisión previamente notificado.";
const TITLE = "Contradicción sobre notificación del acuerdo de admisión (Art. 230 LISSSTE)";

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
            return chain([
              { id: "doc-1", filename: "doc-1.txt", extracted_text: `${QUOTE_A}\n${QUOTE_B}`, status: "extracted" },
            ]);
          if (table === "case_domain_activations") return chain([]);
          if (table === "case_findings")
            return chain([
              {
                id: "existing-analyzer-row",
                category: "contradiction",
                title: TITLE,
                description: "No se advierte contradicción entre el acuerdo y la resolución impugnada.",
                source_module: "analyzer:contradiction",
                evidence_refs: [{ quote: QUOTE_A }],
                confidence: 0.5,
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

describe("addFindings: cross-producer conflict detection", () => {
  it("marks a genuine report-writer vs analyzer disagreement as unresolved instead of silently merging", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const updateCalls: Array<{ id: unknown; payload: Record<string, unknown> }> = [];
    const db = makeFakeDb(updateCalls);

    const rows = [
      {
        case_id: "case-1",
        user_id: "user-1",
        source_module: "report_writer:contradiction",
        category: "contradiction",
        title: TITLE,
        description: "La resolución contradice expresamente el acuerdo previamente notificado.",
        severity: "high" as const,
        confidence: 0.7,
        legal_significance: null,
        potential_impact: null,
        affected_party: null,
        evidence_refs: [{ quote: QUOTE_B }],
        source_doc_ids: ["doc-1"],
        tags: [],
        metadata: {},
      },
    ];

    await addFindings(db as never, rows);

    expect(updateCalls.length).toBeGreaterThan(0);
    const call = updateCalls[0];
    expect(call.id).toBe("existing-analyzer-row");
    expect(call.payload.reconciliation_state).toBe("unresolved");
    const meta = call.payload.metadata as Record<string, unknown>;
    expect(meta.reconciliation_state).toBe("unresolved");
    const conflict = meta.conflict as { claim_a: { source_module: string }; claim_b: { source_module: string } };
    expect([conflict.claim_a.source_module, conflict.claim_b.source_module].sort()).toEqual(
      ["analyzer:contradiction", "report_writer:contradiction"].sort(),
    );
    // Never folded into merged_from — that field means "accepted as the
    // same fact", the opposite of what a genuine disagreement is.
    expect(Array.isArray(meta.merged_from) ? meta.merged_from : []).toHaveLength(0);
  });

  it("still merges normally when two producers restate the same finding with no polarity conflict", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const updateCalls: Array<{ id: unknown; payload: Record<string, unknown> }> = [];
    const db = makeFakeDb(updateCalls);

    const rows = [
      {
        case_id: "case-1",
        user_id: "user-1",
        source_module: "report_writer:contradiction",
        category: "contradiction",
        title: TITLE,
        // No explicit negation/affirmation marker — an ordinary restatement,
        // not a detectable disagreement. Shares the existing row's cited
        // quote (QUOTE_A) so the pre-existing evidence-overlap merge path
        // still applies — two producers citing DIFFERENT, non-overlapping
        // evidence about the same title with no detected conflict are, by
        // this codebase's own pre-existing (unchanged) design, correctly
        // treated as distinct factual bases and never merged; that's not
        // this test's concern.
        description: "El acuerdo de admisión y la resolución impugnada difieren en su contenido.",
        severity: "medium" as const,
        confidence: 0.6,
        legal_significance: null,
        potential_impact: null,
        affected_party: null,
        evidence_refs: [{ quote: QUOTE_A }],
        source_doc_ids: ["doc-1"],
        tags: [],
        metadata: {},
      },
    ];

    await addFindings(db as never, rows);

    expect(updateCalls.length).toBeGreaterThan(0);
    const call = updateCalls[0];
    const meta = call.payload.metadata as Record<string, unknown>;
    expect(meta.reconciliation_state).toBeUndefined();
    expect(call.payload.reconciliation_state).toBeNull();
  });
});
