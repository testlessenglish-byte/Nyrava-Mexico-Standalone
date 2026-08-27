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
// and asserts it recovers by retrying without the missing column(s).
//
// SECOND BUG FIXED HERE (confirmed via a later real case export,
// ADR-4321-2017-180507): the original retry blanket-stripped ALL FIVE
// optional columns (speaker_role/proposition_type/adoption_status/
// audit_classification/evidence_relationship) on ANY insert error, even
// when only ONE of them was actually the problem — e.g. an environment
// where evidence_relationship's migration (20260814150000, the newest of
// the five, added days after the other four) hadn't landed yet, but the
// other four had. That real case's export showed 5 of 6 judicial-hierarchy-
// eligible findings persisted with audit_classification: null at the top
// level despite the LLM having correctly classified them (visible in
// metadata.raw) — the retry was needlessly stripping columns that would
// have inserted fine on their own. addFindings now parses the Postgrest/
// Postgres error to identify the SPECIFIC missing column and strips only
// that one when it can, falling back to the full bundle only when the
// error doesn't name a column in the known-optional set.
import { describe, it, expect } from "vitest";

function makeFakeDb(calls: { insert: Array<Record<string, unknown>[]> }, errors: unknown[]) {
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
          const attemptIndex = calls.insert.length - 1;
          return {
            select: () => ({
              then: (resolve: (v: unknown) => void) => {
                if (attemptIndex < errors.length) {
                  resolve({ data: null, error: errors[attemptIndex] });
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

const sampleRow = {
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
};

describe("addFindings: schema-drift resilience on the judicial-hierarchy columns", () => {
  it("recovers a whole batch after a single column-does-not-exist error by retrying without ONLY that column", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const calls = { insert: [] as Array<Record<string, unknown>[]> };
    const db = makeFakeDb(calls, [
      {
        message: 'column "speaker_role" of relation "case_findings" does not exist',
        code: "42703",
      },
    ]);

    const result = await addFindings(db as never, [sampleRow]);

    expect(calls.insert).toHaveLength(2);
    expect(calls.insert[0][0]).toHaveProperty("speaker_role");
    expect(calls.insert[1][0]).not.toHaveProperty("speaker_role");
    // The real bug: proposition_type/adoption_status/audit_classification
    // were NEVER reported missing — they must survive the retry, not be
    // collaterally stripped alongside the one column that actually failed.
    expect(calls.insert[1][0]).toHaveProperty("proposition_type");
    expect(calls.insert[1][0]).toHaveProperty("adoption_status");
    expect(calls.insert[1][0]).toHaveProperty("audit_classification");
    expect(result).toHaveLength(1);
  });

  it("the real reported gap: an evidence_relationship-only schema-cache error no longer collaterally drops speaker_role/audit_classification", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const calls = { insert: [] as Array<Record<string, unknown>[]> };
    const db = makeFakeDb(calls, [
      {
        message: "Could not find the 'evidence_relationship' column of 'case_findings' in the schema cache",
        code: "PGRST204",
      },
    ]);

    await addFindings(db as never, [
      { ...sampleRow, speaker_role: "scjn", proposition_type: "holding", adoption_status: "adopted", audit_classification: "VERIFIED_COURT_HOLDING" },
    ]);

    expect(calls.insert).toHaveLength(2);
    expect(calls.insert[1][0]).not.toHaveProperty("evidence_relationship");
    expect(calls.insert[1][0].speaker_role).toBe("scjn");
    expect(calls.insert[1][0].proposition_type).toBe("holding");
    expect(calls.insert[1][0].adoption_status).toBe("adopted");
    expect(calls.insert[1][0].audit_classification).toBe("VERIFIED_COURT_HOLDING");
  });

  it("preserves verified findings when a Penal legal-semantics column has not propagated", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const calls = { insert: [] as Array<Record<string, unknown>[]> };
    const db = makeFakeDb(calls, [
      { message: "Could not find the 'benefited_party' column of 'case_findings' in the schema cache" },
    ]);
    await addFindings(db as never, [
      {
        ...sampleRow,
        speaker_role: "scjn",
        proposition_type: "court_holding",
        adoption_status: "adopted",
        audit_classification: "VERIFIED_COURT_HOLDING",
        benefited_party: "neutral",
      },
    ]);
    expect(calls.insert).toHaveLength(2);
    expect(calls.insert[1][0]).not.toHaveProperty("benefited_party");
    expect(calls.insert[1][0]).toHaveProperty("audit_classification", "VERIFIED_COURT_HOLDING");
    expect(calls.insert[1][0]).toHaveProperty("proposition_type", "court_holding");
  });

  it("falls back to stripping the full known-optional bundle when the single-column retry also fails", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const calls = { insert: [] as Array<Record<string, unknown>[]> };
    const db = makeFakeDb(calls, [
      {
        message: 'column "speaker_role" of relation "case_findings" does not exist',
        code: "42703",
      },
      {
        message: 'column "proposition_type" of relation "case_findings" does not exist',
        code: "42703",
      },
    ]);

    const result = await addFindings(db as never, [sampleRow]);

    expect(calls.insert).toHaveLength(3);
    expect(calls.insert[2][0]).not.toHaveProperty("speaker_role");
    expect(calls.insert[2][0]).not.toHaveProperty("proposition_type");
    expect(calls.insert[2][0]).not.toHaveProperty("adoption_status");
    expect(calls.insert[2][0]).not.toHaveProperty("audit_classification");
    expect(calls.insert[2][0]).not.toHaveProperty("evidence_relationship");
    expect(result).toHaveLength(1);
  });

  it("falls back to stripping the full bundle immediately when the error doesn't name a recognizable column", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const calls = { insert: [] as Array<Record<string, unknown>[]> };
    const db = makeFakeDb(calls, [{ message: "connection reset", code: "08006" }]);

    const result = await addFindings(db as never, [sampleRow]);

    expect(calls.insert).toHaveLength(2);
    expect(calls.insert[1][0]).not.toHaveProperty("speaker_role");
    expect(calls.insert[1][0]).not.toHaveProperty("audit_classification");
    expect(result).toHaveLength(1);
  });
});
