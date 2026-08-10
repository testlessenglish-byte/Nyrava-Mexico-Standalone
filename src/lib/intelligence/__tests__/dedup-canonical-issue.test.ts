// Regression tests for Phase 1 of the "Universal Completed Case Legal Audit
// Architecture Fix": dedupSemantically() in findings.server.ts used to group
// findings by an EXACT `category::first-6-normalized-words` key, so two
// engines describing the same canonical issue under different category
// labels (a routine occurrence — e.g. a constitutional-rights engine and a
// conventionality engine both flagging the same due-process defect) were
// never recognized as duplicates and persisted as separate case_findings
// rows. dedupSemantically now clusters via clusterBySameIssue() (finding-
// dedupe.ts) — the same title-Jaccard / cross-category-corroboration rule
// already proven in production for report-time consolidation — so a
// canonical issue means the same thing at persist time as it does in the
// final report. These tests exercise the real addFindings() write path (not
// the pure clustering function directly, since dedupSemantically is
// intentionally unexported) against a fake db seeded the same way as
// findings-merge-preserves-classification.test.ts.
import { describe, it, expect } from "vitest";

const QUOTE_A =
  "no se notificó al quejoso el acuerdo de admisión dentro del plazo legal establecido para tal efecto";
const QUOTE_B =
  "la autoridad responsable omitió fundar y motivar la resolución impugnada en los términos exigidos";

function makeFakeDb(opts: {
  existing: Array<Record<string, unknown>>;
  inserts: Array<Record<string, unknown>>;
  updates: Array<{ id: unknown; payload: Record<string, unknown> }>;
}) {
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
          if (table === "cases")
            return chain({ case_type: "amparo", analysis_mode: "exploratory" });
          if (table === "documents")
            return chain([
              {
                id: "doc-1",
                filename: "doc-1.txt",
                extracted_text: `${QUOTE_A} ${QUOTE_B}`,
                status: "extracted",
              },
            ]);
          if (table === "case_domain_activations") return chain([]);
          if (table === "case_findings") return chain(opts.existing);
          return chain([]);
        },
        insert(payload: unknown) {
          const rows = Array.isArray(payload) ? payload : [payload];
          opts.inserts.push(...(rows as Array<Record<string, unknown>>));
          return {
            select: () => ({ then: (r: (v: unknown) => void) => r({ data: rows, error: null }) }),
          };
        },
        update(payload: Record<string, unknown>) {
          return {
            eq: (_col: string, id: unknown) => {
              opts.updates.push({ id, payload });
              return Promise.resolve({ error: null });
            },
          };
        },
        delete: () => ({ eq: () => ({ like: () => Promise.resolve({ error: null }) }) }),
      };
    },
  };
}

const baseRow = (o: Record<string, unknown>) => ({
  case_id: "case-1",
  user_id: "user-1",
  severity: "medium" as const,
  confidence: 0.8,
  legal_significance: null,
  potential_impact: null,
  affected_party: null,
  source_doc_ids: ["doc-1"],
  tags: [],
  metadata: {},
  ...o,
});

describe("addFindings: canonical-issue dedup across category labels", () => {
  it("merges two engines' findings for the same issue emitted under different categories, given shared evidence", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ id: unknown; payload: Record<string, unknown> }> = [];
    const db = makeFakeDb({ existing: [], inserts, updates });

    const rows = [
      baseRow({
        source_module: "agent:ways_out_analysis",
        category: "constitutional_rights_mapping",
        title: "Falta de notificación oportuna del acuerdo de admisión",
        description: "El acuerdo de admisión no fue notificado al quejoso dentro del plazo legal.",
        evidence_refs: [{ doc_n: 1, quote: QUOTE_A }],
      }),
      baseRow({
        source_module: "agent:ways_out_analysis",
        category: "conventionality_pro_persona",
        // Same headline as the row above (two engines converging on the same
        // canonical issue routinely produce identical or near-identical
        // titles) — the corroborating signal for the cross-category merge is
        // the shared evidence quote, not the wording alone.
        title: "Falta de notificación oportuna del acuerdo de admisión",
        description: "La autoridad no notificó oportunamente el acuerdo de admisión al quejoso.",
        evidence_refs: [{ doc_n: 1, quote: QUOTE_A }],
      }),
    ];

    await addFindings(db as never, rows);

    // One canonical issue, one persisted row — not two.
    expect(inserts.length).toBe(1);
    const meta = inserts[0].metadata as Record<string, unknown> | undefined;
    // The losing category must not vanish silently — merged_from carries its
    // provenance even though only the winner's category is the row's own.
    expect(Array.isArray(meta?.merged_from)).toBe(true);
    expect((meta?.merged_from as unknown[]).length).toBe(1);
  });

  it("does NOT merge two different issues merely because they cite the same statute", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ id: unknown; payload: Record<string, unknown> }> = [];
    const db = makeFakeDb({ existing: [], inserts, updates });

    const rows = [
      baseRow({
        source_module: "agent:ways_out_analysis",
        category: "constitutional_rights_mapping",
        title: "Falta de notificación oportuna del acuerdo de admisión",
        description:
          "El acuerdo de admisión no fue notificado al quejoso dentro del plazo legal. CNPP art. 227.",
        evidence_refs: [{ doc_n: 1, quote: QUOTE_A }],
        citations: ["CNPP art. 227"],
      }),
      baseRow({
        source_module: "agent:ways_out_analysis",
        category: "procedural_violations",
        title: "Omisión de fundamentación y motivación de la resolución impugnada",
        description:
          "La autoridad responsable omitió fundar y motivar la resolución impugnada. CNPP art. 227.",
        evidence_refs: [{ doc_n: 1, quote: QUOTE_B }],
        citations: ["CNPP art. 227"],
      }),
    ];

    await addFindings(db as never, rows);

    // Two distinct legal issues that happen to cite the same article must
    // stay separate — a shared citation alone is never sufficient
    // corroboration for a cross-category merge.
    expect(inserts.length).toBe(2);
  });

  it("still refuses to merge same-category findings with dissimilar titles and no shared evidence", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ id: unknown; payload: Record<string, unknown> }> = [];
    const db = makeFakeDb({ existing: [], inserts, updates });

    const rows = [
      baseRow({
        source_module: "agent:ways_out_analysis",
        category: "procedural_violations",
        title: "Falta de notificación oportuna del acuerdo de admisión",
        description: "El acuerdo de admisión no fue notificado al quejoso dentro del plazo legal.",
        evidence_refs: [{ doc_n: 1, quote: QUOTE_A }],
      }),
      baseRow({
        source_module: "agent:ways_out_analysis",
        category: "procedural_violations",
        title: "Omisión de fundamentación y motivación de la resolución impugnada",
        description: "La autoridad responsable omitió fundar y motivar la resolución impugnada.",
        evidence_refs: [{ doc_n: 1, quote: QUOTE_B }],
      }),
    ];

    await addFindings(db as never, rows);
    expect(inserts.length).toBe(2);
  });

  it("merges a fresh cross-category finding into an existing persisted row when they share evidence", async () => {
    const { addFindings } = await import("@/lib/intelligence/findings.server");
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ id: unknown; payload: Record<string, unknown> }> = [];
    const db = makeFakeDb({
      existing: [
        {
          id: "existing-row-1",
          category: "constitutional_rights_mapping",
          title: "Falta de notificación oportuna del acuerdo de admisión",
          evidence_refs: [{ doc_n: 1, quote: QUOTE_A }],
          confidence: 0.6,
          source_doc_ids: ["doc-1"],
          metadata: {},
        },
      ],
      inserts,
      updates,
    });

    const rows = [
      baseRow({
        source_module: "agent:ways_out_analysis",
        category: "conventionality_pro_persona",
        title: "Falta de notificación oportuna del acuerdo de admisión",
        description: "La autoridad no notificó oportunamente el acuerdo de admisión al quejoso.",
        evidence_refs: [{ doc_n: 1, quote: QUOTE_A }],
      }),
    ];

    await addFindings(db as never, rows);

    // The existing row is the merge anchor (downstream tables already point
    // at its id) — this must be an UPDATE, not a second INSERT.
    expect(inserts.length).toBe(0);
    expect(updates.length).toBe(1);
    expect(updates[0].id).toBe("existing-row-1");
  });
});
