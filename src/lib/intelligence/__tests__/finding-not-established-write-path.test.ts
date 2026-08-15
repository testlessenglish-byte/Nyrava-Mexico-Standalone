// End-to-end regression test for the write-path bug fixed alongside this
// file: a notEstablishedTopic finding (see procedural-defect-grounding.server.ts
// and evidence-gate.server.ts's GatedItem.not_established_rewrite) was being
// silently dropped by addGatedFindings() even after diagnoseEvidenceGate()
// correctly decided to keep it — an earlier version of the fix rewrote
// gated.title/gated.description directly, which broke the
// `${title}::${description}` lookup addGatedFindings uses to reunite a gate
// result with its input row. This exercises the REAL addGatedFindings()
// (not a re-implementation) with a fake db, following this codebase's
// established mocking convention (see ai-theory-exclusion.test.ts), and
// asserts the finding that actually reaches `.insert()` carries the
// rewritten "NO ESTABLECIDO" title — i.e. it was kept, not dropped.
import { describe, it, expect } from "vitest";

const RULE_QUOTE =
  "La notificación deberá hacerse personalmente al quejoso conforme al artículo 26 de la Ley de Amparo.";

function makeFakeDb(insertedRows: { payload: unknown }[]) {
  function chain(resolveValue: unknown) {
    const c: Record<string, unknown> = {
      eq: () => c,
      not: () => c,
      like: () => c,
      order: () => c,
      limit: () => c,
      // resolveCaseIdentity's case_classification_evidence lookup ends in
      // .in(...) rather than .maybeSingle() — no evidence rows by default,
      // so identity resolution falls through to the declared cases.case_type
      // above ("amparo"), matching this fake db's simulated case row.
      in: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: resolveValue, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: resolveValue, error: null }),
    };
    return c;
  }
  return {
    from(table: string) {
      return {
        select() {
          if (table === "cases")
            return chain({
              case_type: "amparo",
              case_type_source: null,
              jurisdiction: null,
              analysis_mode: "exploratory",
            });
          if (table === "documents")
            return chain([{ id: "doc-1", filename: "doc-1.txt", extracted_text: RULE_QUOTE, status: "extracted" }]);
          if (table === "case_domain_activations") return chain([]);
          if (table === "case_findings") return chain([]); // no existing findings — nothing to dedup against
          return chain([]);
        },
        insert(payload: unknown) {
          insertedRows.push({ payload });
          const rows = Array.isArray(payload) ? payload : [payload];
          return { select: () => ({ then: (r: (v: unknown) => void) => r({ data: rows, error: null }) }) };
        },
        delete: () => ({ eq: () => ({ like: () => Promise.resolve({ error: null }) }) }),
      };
    },
  };
}

describe("addGatedFindings: notEstablishedTopic finding survives the full write path", () => {
  it("a bare-legal-rule finding reaches the final insert payload with the NO ESTABLECIDO title, not dropped", async () => {
    const { addGatedFindings } = await import("@/lib/intelligence/findings.server");
    const inserted: { payload: unknown }[] = [];
    const db = makeFakeDb(inserted);

    const rows = [
      {
        case_id: "case-1",
        user_id: "user-1",
        source_module: "agent:authority_notification_validation",
        category: "authority_notification_validation",
        title: "Notificación Defectuosa",
        description: "La notificación de la sentencia se realizó por lista.",
        severity: "high" as const,
        confidence: 0.95,
        legal_significance: null,
        potential_impact: null,
        affected_party: null,
        evidence_refs: [{ doc_n: 1, quote: RULE_QUOTE }],
        source_doc_ids: ["doc-1"],
        tags: [],
        metadata: {},
      },
    ];

    const result = await addGatedFindings(db as never, "case-1", rows);

    expect(result.inserted).toBe(1);
    expect(inserted.length).toBeGreaterThan(0);
    const insertedPayload = (Array.isArray(inserted[0].payload) ? inserted[0].payload : [inserted[0].payload]) as Array<
      Record<string, unknown>
    >;
    const row = insertedPayload[0];
    expect(row.finding_type).toBe("AI_THEORY");
    expect(String(row.title)).toMatch(/^NO ESTABLECIDO/);
  });
});
