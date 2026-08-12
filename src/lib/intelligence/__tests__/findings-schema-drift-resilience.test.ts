// Regression test for a uniform, cross-category, 100%-of-batch case_findings
// loss discovered via real case exports (ADR-4640-2017-180212): the
// speaker_role/proposition_type/adoption_status columns added in migration
// 20260808201119_finding_judicial_attribution.sql are written on EVERY
// finding row (see the payload builder in addFindings), even when null.
// Postgres batch INSERT is atomic — if an environment hasn't picked up that
// migration yet, the whole batch is rejected with no per-row signal, and the
// previous code silently logged the error and returned []. That reads
// identically to "the agents found nothing," which is what the real case
// exports showed (18 real, evidence-grounded findings generated, 0
// persisted) even for finding categories that were never gated out by
// isFindingAllowed. This exercises the REAL addFindings() against a fake db
// that fails the first insert with a Postgres "column does not exist" error
// and asserts it recovers by retrying without those three columns.
import { describe, it, expect } from "vitest";

function makeFakeDb(calls: { insert: Array<Record<string, unknown>[]> }) {
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
          if (table === "documents") return chain([]);
          if (table === "case_domain_activations") return chain([]);
          if (table === "case_findings") return chain([]);
          return chain([]);
        },
        insert(payload: unknown) {
          const rows = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
          calls.insert.push(rows);
          const isFirstAttempt = calls.insert.length === 1;
          return {
            select: () => ({
              then: (resolve: (v: unknown) => void) => {
                if (isFirstAttempt) {
                  resolve({
                    data: null,
                    error: {
                      message: 'column "speaker_role" of relation "case_findings" does not exist',
                      code: "42703",
                    },
                  });
                } else {
                  resolve({ data: rows.map((_, i) => ({ id: `new-${i}` })), error: null });
                }
              },
            }),
          };
        },
        delete: () => ({ eq: () => ({ like: () => Promise.resolve({ error: null }) }) }),
      };
    },
  };
}

describe("addFindings: schema-drift resilience on the judicial-hierarchy columns", () => {
  it("recovers a whole batch after a column-does-not-exist error by retrying without those columns", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const calls = { insert: [] as Array<Record<string, unknown>[]> };
    const db = makeFakeDb(calls);

    const rows = [
      {
        case_id: "case-1",
        user_id: "user-1",
        source_module: "agent:witness_credibility",
        category: "witness",
        title: "Testimonio inconsistente",
        description: "El testigo declaró hechos contradictorios sobre la fecha de los hechos.",
        severity: "high" as const,
        confidence: 0.9,
        legal_significance: null,
        potential_impact: null,
        affected_party: null,
        // audit B8 (stale test): the original quote here ("El testigo
        // declaró...") had only 2 non-stopword tokens, tripping
        // checkClaimEvidenceRelevance's later-added quote_too_vacuous gate
        // (claim-evidence-relevance.ts, min 3 substantive tokens) before
        // addFindings ever reached the schema-drift retry path this test
        // is actually about. Lengthened to a real, on-topic verbatim quote
        // so the test exercises its intended scenario again.
        evidence_refs: [
          {
            doc_n: 1,
            quote:
              "El testigo declaró que los hechos ocurrieron el día 5, pero en su declaración anterior había afirmado que ocurrieron el día 8",
          },
        ],
        source_doc_ids: ["doc-1"],
        tags: [],
        metadata: {},
      },
    ];

    const result = await addFindings(db as never, rows);

    expect(calls.insert).toHaveLength(2);
    expect(calls.insert[0][0]).toHaveProperty("speaker_role");
    expect(calls.insert[1][0]).not.toHaveProperty("speaker_role");
    expect(calls.insert[1][0]).not.toHaveProperty("proposition_type");
    expect(calls.insert[1][0]).not.toHaveProperty("adoption_status");
    expect(result).toHaveLength(1);
  });
});
