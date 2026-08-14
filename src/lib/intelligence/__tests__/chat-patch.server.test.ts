// Regression tests for the "Push to Report" architecture fix: Talk-to-Case
// must apply a grounded patch set (keep|amend|remove|merge|create) directly
// to the EXISTING case_findings rows and never fall back to the old
// addEvidenceAndRerun-based full-pipeline rerun. These tests exercise
// generateFindingPatchSet/applyFindingPatchSet against a fake db that throws
// on any table access outside case_findings/case_finding_patches/cases/
// user_ai_keys — proving neither function ever touches documents,
// pipeline_engine_runs, or any other pipeline-rerun machinery.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/groq.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/groq.server")>();
  return { ...actual, callGroq: vi.fn() };
});

vi.mock("@/lib/intelligence/findings.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intelligence/findings.server")>();
  return { ...actual, addFindings: vi.fn() };
});

import { callGroq } from "@/lib/groq.server";
import { addFindings } from "@/lib/intelligence/findings.server";
import {
  generateFindingPatchSet,
  applyFindingPatchSet,
  computeCorrectionImpact,
  findStaleCitations,
  recordLesson,
} from "@/lib/intelligence/chat-patch.server";

beforeEach(() => {
  vi.mocked(callGroq).mockReset();
  vi.mocked(addFindings).mockReset();
});

function baseFinding(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "finding-1",
    case_id: "case-1",
    user_id: "user-1",
    source_module: "engine:jurisdiction_intel",
    category: "standing",
    title: "Notificación defectuosa del auto de radicación",
    description:
      "El auto de radicación no fue notificado conforme al artículo 26 de la Ley de Amparo.",
    severity: "high" as const,
    confidence: 0.7,
    evidence_refs: [{ doc_id: "doc-1", quote: "original evidence quote" }],
    source_doc_ids: ["doc-1"],
    metadata: {},
    superseded_at: null as string | null,
    superseded_reason: null as string | null,
    lifecycle_status: null as string | null,
    derived_from_finding_ids: [] as string[],
    canonical_finding_id: null as string | null,
    created_at: "2026-08-09T14:25:00.000Z",
    updated_at: "2026-08-09T14:25:00.000Z",
    ...overrides,
  };
}

// Mirrors the fake db pattern already established in
// case-state-reconciliation.test.ts, extended with the update/select shapes
// applyFindingPatchSet actually issues (targeted single-row select for
// "amend", multi-row .in() select for "merge", and a case_finding_patches
// audit insert). Throws on any table this architecture must NOT touch
// (documents, pipeline_engine_runs, cases-writes, etc.) so a regression that
// reintroduces a full-pipeline dependency fails loudly.
function makeFakeDb(opts: {
  findings: Array<Record<string, unknown>>;
  /** Seeds case_finding_patches' SELECT path (correction memory) — separate
   *  from `patchRows`, which captures newly-INSERTed audit rows. Defaults to
   *  no prior history. */
  priorPatches?: Array<Record<string, unknown>>;
  /** Seeds documents rows so a dispute_evidence/amend patch's
   *  source_document_purpose write has something real to update. */
  documents?: Array<Record<string, unknown>>;
}) {
  const patchRows: Array<Record<string, unknown>> = [];
  const lessonRows: Array<Record<string, unknown>> = [];
  const patternRows: Array<Record<string, unknown>> = [];
  const documentUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const touchedTables = new Set<string>();
  const documents = opts.documents ?? [];

  function findingsChain() {
    const self: Record<string, unknown> = {
      eq: () => self,
      not: () => self,
      like: () => self,
      order: () => self,
      limit: () => self,
      is: (col: string, val: null) => {
        if (col === "superseded_at" && val === null) {
          return {
            then: (resolve: (v: unknown) => void) =>
              resolve({ data: opts.findings.filter((f) => f.superseded_at == null), error: null }),
          };
        }
        return self;
      },
      then: (resolve: (v: unknown) => void) => resolve({ data: opts.findings, error: null }),
    };
    return self;
  }

  const db = {
    from(table: string) {
      touchedTables.add(table);
      if (table === "case_findings") {
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              if (col === "id") {
                return {
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: opts.findings.find((f) => f.id === val) ?? null,
                        error: null,
                      }),
                  }),
                };
              }
              // case_id — continue the listFindings() chain semantics.
              return findingsChain();
            },
            in: (_col: string, vals: string[]) => {
              const filtered = opts.findings.filter((f) => vals.includes(f.id as string));
              return {
                eq: () => Promise.resolve({ data: filtered, error: null }),
                // aggregateIntelligencePatterns awaits .in(...) directly
                // (no further .eq()) to resolve category_samples.
                then: (resolve: (v: unknown) => void) => resolve({ data: filtered, error: null }),
              };
            },
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (col1: string, id: string) => ({
              eq: () => {
                if (col1 === "id") {
                  const row = opts.findings.find((f) => f.id === id);
                  if (!row) return Promise.resolve({ error: { message: "not found" } });
                  Object.assign(row, payload);
                }
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }
      if (table === "case_finding_patches") {
        return {
          insert: (row: Record<string, unknown>) => {
            const id = `patch-audit-${patchRows.length}`;
            patchRows.push({ ...row, id });
            return {
              select: () => ({
                maybeSingle: () => Promise.resolve({ data: { id }, error: null }),
              }),
            };
          },
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: opts.priorPatches ?? [], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "cases") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { report_language: "es" }, error: null }),
            }),
          }),
        };
      }
      if (table === "documents") {
        return {
          update: (payload: Record<string, unknown>) => ({
            eq: (col1: string, id: string) => ({
              eq: () => {
                if (col1 === "id") {
                  const row = documents.find((d) => d.id === id);
                  if (!row) return Promise.resolve({ error: { message: "not found" } });
                  Object.assign(row, payload);
                  documentUpdates.push({ id, payload });
                }
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }
      if (table === "intelligence_lessons") {
        return {
          insert: (row: Record<string, unknown>) => {
            const id = `lesson-${lessonRows.length}`;
            lessonRows.push({ ...row, id });
            return Promise.resolve({ error: null });
          },
          select: () => queryBuilder(lessonRows),
        };
      }
      if (table === "intelligence_patterns") {
        return {
          select: () => queryBuilder(patternRows),
          upsert: (
            row: Record<string, unknown>,
            opts: { onConflict: string },
          ) => {
            const keyCols = opts.onConflict.split(",");
            const existing = patternRows.find((p) =>
              keyCols.every((c) => p[c] === row[c]),
            );
            if (existing) Object.assign(existing, row);
            else patternRows.push({ ...row });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "user_ai_keys") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    order: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(
        `unexpected table in fake db (Push-to-Report must never touch this): ${table}`,
      );
    },
  };

  return { db, patchRows, lessonRows, patternRows, documentUpdates, documents, touchedTables };
}

function mockPatchLlmResponse(patches: unknown[]) {
  vi.mocked(callGroq).mockResolvedValue({
    text: JSON.stringify({ patches }),
    latencyMs: 10,
    model: "test-model",
    provider: "groq",
  } as never);
}

const EXCHANGE = {
  question: "¿La notificación del auto de radicación fue correcta?",
  answer:
    'No, la notificación fue defectuosa. Confirmed in the record: "la cédula de notificación se fijó en un domicilio distinto al señalado por el quejoso", lo que vicia el procedimiento.',
  attachedDocs: [],
};

describe("generateFindingPatchSet", () => {
  it("includes a patch whose quote is grounded in the chat exchange", async () => {
    const finding = baseFinding();
    const { db } = makeFakeDb({ findings: [finding] });
    mockPatchLlmResponse([
      {
        action: "remove",
        finding_ids: ["finding-1"],
        reason: "La notificación sí fue defectuosa, pero por un motivo distinto al identificado.",
        quote:
          "la cédula de notificación se fijó en un domicilio distinto al señalado por el quejoso",
        confidence: 0.9,
      },
    ]);

    const result = await generateFindingPatchSet(db as never, "case-grounded", "user-1", EXCHANGE);
    expect(result.patches).toHaveLength(1);
    expect(result.patches[0].action).toBe("remove");
    expect(result.patches[0].finding_ids).toEqual(["finding-1"]);
    expect(result.ungrounded).toBe(0);
  });

  it("includes relevant correction memory (a prior patch touching a visible finding) in the LLM prompt, bounded to what's relevant", async () => {
    const finding = baseFinding();
    const irrelevantFinding = baseFinding({ id: "finding-unrelated" });
    const { db } = makeFakeDb({
      findings: [finding, irrelevantFinding],
      priorPatches: [
        {
          action: "amend",
          reason: "Se corrigió la fecha de notificación tras revisar el expediente físico.",
          finding_id: "finding-1",
          result_finding_id: "finding-1",
          source_document_id: null,
          applied_at: "2026-08-10T00:00:00.000Z",
        },
        // Targets a finding NOT currently visible to this call — must be
        // excluded, proving the memory query is relevance-scoped, not a
        // full-history dump.
        {
          action: "remove",
          reason: "Unrelated prior correction on a different finding.",
          finding_id: "finding-not-shown",
          result_finding_id: null,
          source_document_id: null,
          applied_at: "2026-08-11T00:00:00.000Z",
        },
      ],
    });
    mockPatchLlmResponse([]);

    await generateFindingPatchSet(db as never, "case-memory", "user-1", EXCHANGE);

    const call = vi.mocked(callGroq).mock.calls[0][0] as { userContent: string };
    expect(call.userContent).toContain("KNOWN PRIOR CORRECTIONS");
    expect(call.userContent).toContain("Se corrigió la fecha de notificación");
    expect(call.userContent).not.toContain("Unrelated prior correction on a different finding");
  });

  it("omits the correction-memory block entirely when no prior patch is relevant", async () => {
    const finding = baseFinding();
    const { db } = makeFakeDb({
      findings: [finding],
      priorPatches: [
        {
          action: "remove",
          reason: "Unrelated prior correction.",
          finding_id: "finding-not-shown",
          result_finding_id: null,
          source_document_id: null,
          applied_at: "2026-08-11T00:00:00.000Z",
        },
      ],
    });
    mockPatchLlmResponse([]);

    await generateFindingPatchSet(db as never, "case-no-memory", "user-1", EXCHANGE);

    const call = vi.mocked(callGroq).mock.calls[0][0] as { userContent: string };
    expect(call.userContent).not.toContain("KNOWN PRIOR CORRECTIONS");
  });

  it("discards a patch whose quote does not actually appear in the exchange or an attached document", async () => {
    const finding = baseFinding();
    const { db } = makeFakeDb({ findings: [finding] });
    mockPatchLlmResponse([
      {
        action: "remove",
        finding_ids: ["finding-1"],
        reason: "Invented justification.",
        quote: "This sentence was never said in the exchange and was invented by the model.",
        confidence: 0.9,
      },
    ]);

    const result = await generateFindingPatchSet(
      db as never,
      "case-ungrounded",
      "user-1",
      EXCHANGE,
    );
    expect(result.patches).toHaveLength(0);
    expect(result.ungrounded).toBe(1);
  });

  it("discards a patch that targets a finding id the model invented", async () => {
    const finding = baseFinding();
    const { db } = makeFakeDb({ findings: [finding] });
    mockPatchLlmResponse([
      {
        action: "remove",
        finding_ids: ["finding-does-not-exist"],
        reason: "Hallucinated id.",
        quote:
          "la cédula de notificación se fijó en un domicilio distinto al señalado por el quejoso",
        confidence: 0.9,
      },
    ]);

    const result = await generateFindingPatchSet(db as never, "case-bad-id", "user-1", EXCHANGE);
    expect(result.patches).toHaveLength(0);
  });

  it("discards an amend patch missing new_title/new_description", async () => {
    const finding = baseFinding();
    const { db } = makeFakeDb({ findings: [finding] });
    mockPatchLlmResponse([
      {
        action: "amend",
        finding_ids: ["finding-1"],
        reason: "Needs correction.",
        quote:
          "la cédula de notificación se fijó en un domicilio distinto al señalado por el quejoso",
        confidence: 0.8,
        // new_title / new_description omitted
      },
    ]);

    const result = await generateFindingPatchSet(
      db as never,
      "case-incomplete-amend",
      "user-1",
      EXCHANGE,
    );
    expect(result.patches).toHaveLength(0);
  });

  it("discards a create patch that also lists finding_ids (create must target nothing existing)", async () => {
    const finding = baseFinding();
    const { db } = makeFakeDb({ findings: [finding] });
    mockPatchLlmResponse([
      {
        action: "create",
        finding_ids: ["finding-1"],
        reason: "New issue.",
        quote:
          "la cédula de notificación se fijó en un domicilio distinto al señalado por el quejoso",
        confidence: 0.8,
        new_title: "New finding",
        new_description: "New finding description.",
      },
    ]);

    const result = await generateFindingPatchSet(
      db as never,
      "case-bad-create",
      "user-1",
      EXCHANGE,
    );
    expect(result.patches).toHaveLength(0);
  });
});

describe("applyFindingPatchSet", () => {
  it("'remove' supersedes the row without deleting it, and writes an audit row", async () => {
    const finding = baseFinding();
    const { db, patchRows, touchedTables } = makeFakeDb({ findings: [finding] });
    const patch = {
      action: "remove" as const,
      finding_ids: ["finding-1"],
      reason: "El abogado aclaró que la notificación fue correcta.",
      quote: "quote text",
      source_document_id: null,
      confidence: 0.9,
    };

    const outcomes = await applyFindingPatchSet(db as never, "case-1", "user-1", [patch], "msg-1");

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ applied: true, action: "remove", result_finding_id: null });
    expect(finding.superseded_at).toBeTruthy();
    expect(String(finding.superseded_reason)).toContain("quote text");
    // The row itself is never deleted — same id, still present.
    expect(finding.id).toBe("finding-1");
    expect(finding.lifecycle_status).toBe("superseded");

    expect(patchRows).toHaveLength(1);
    expect(patchRows[0]).toMatchObject({
      action: "remove",
      finding_id: "finding-1",
      chat_message_id: "msg-1",
    });

    // Never touches documents, pipeline_engine_runs, or any pipeline-queue
    // table — proves this path is fully decoupled from a full rerun.
    expect(touchedTables.has("documents")).toBe(false);
    expect(touchedTables.has("pipeline_engine_runs")).toBe(false);
    expect(vi.mocked(addFindings)).not.toHaveBeenCalled();
  });

  it("'amend' updates the SAME finding id in place — no new row, old row not superseded", async () => {
    const finding = baseFinding();
    const { db, touchedTables } = makeFakeDb({ findings: [finding] });
    const patch = {
      action: "amend" as const,
      finding_ids: ["finding-1"],
      reason: "El defecto real es distinto al identificado originalmente.",
      quote:
        "la cédula de notificación se fijó en un domicilio distinto al señalado por el quejoso",
      source_document_id: null,
      confidence: 0.85,
      new_title: "Notificación defectuosa por domicilio incorrecto",
      new_description: "La cédula se fijó en un domicilio distinto al señalado por el quejoso.",
      new_severity: "critical" as const,
    };

    const outcomes = await applyFindingPatchSet(db as never, "case-1", "user-1", [patch], "msg-1");

    expect(outcomes[0]).toMatchObject({
      applied: true,
      action: "amend",
      result_finding_id: "finding-1",
    });
    // Same id, content updated, never marked superseded.
    expect(finding.id).toBe("finding-1");
    expect(finding.title).toBe("Notificación defectuosa por domicilio incorrecto");
    expect(finding.severity).toBe("critical");
    expect(finding.superseded_at).toBeFalsy();
    expect(finding.lifecycle_status).toBe("corrected");
    // Original evidence ref preserved, new one appended (union, not replace).
    expect(finding.evidence_refs as unknown[]).toHaveLength(2);
    expect(vi.mocked(addFindings)).not.toHaveBeenCalled();
    expect(touchedTables.has("documents")).toBe(false);
    expect(touchedTables.has("pipeline_engine_runs")).toBe(false);
  });

  it("'merge' consolidates into the primary row and supersedes only the others", async () => {
    const primary = baseFinding({ id: "finding-A", evidence_refs: [{ quote: "A evidence" }] });
    const other = baseFinding({ id: "finding-B", evidence_refs: [{ quote: "B evidence" }] });
    const { db } = makeFakeDb({ findings: [primary, other] });
    const patch = {
      action: "merge" as const,
      finding_ids: ["finding-A", "finding-B"],
      reason: "Son el mismo defecto de notificación descrito dos veces.",
      quote:
        "la cédula de notificación se fijó en un domicilio distinto al señalado por el quejoso",
      source_document_id: null,
      confidence: 0.8,
      new_title: "Notificación defectuosa (consolidado)",
      new_description: "Consolidated description.",
    };

    const outcomes = await applyFindingPatchSet(db as never, "case-1", "user-1", [patch], "msg-1");

    expect(outcomes[0]).toMatchObject({
      applied: true,
      action: "merge",
      result_finding_id: "finding-A",
    });
    expect(primary.title).toBe("Notificación defectuosa (consolidado)");
    expect(primary.superseded_at).toBeFalsy();
    // Evidence unioned from both source rows plus the grounding quote.
    expect((primary.evidence_refs as unknown[]).length).toBeGreaterThanOrEqual(3);
    // Only the non-primary input is superseded.
    expect(other.superseded_at).toBeTruthy();
    expect(String(other.superseded_reason)).toContain("finding-A");
    expect(vi.mocked(addFindings)).not.toHaveBeenCalled();
    // Lifecycle + dependency-graph persistence (§9/§15): the survivor is
    // "corrected" (absorbed content) and now derived_from the id it
    // absorbed; the absorbed row is "superseded", not corrected.
    expect(primary.lifecycle_status).toBe("corrected");
    expect(primary.derived_from_finding_ids).toEqual(["finding-B"]);
    expect(other.lifecycle_status).toBe("superseded");
  });

  it("'create' inserts a brand-new finding via addFindings and never supersedes anything", async () => {
    const finding = baseFinding();
    const newFinding = baseFinding({ id: "finding-new", title: "Nuevo hallazgo" });
    const { db, patchRows } = makeFakeDb({ findings: [finding, newFinding] });
    vi.mocked(addFindings).mockResolvedValue([{ id: "finding-new" }] as never);
    const patch = {
      action: "create" as const,
      finding_ids: [],
      reason: "El abogado reveló un hecho nuevo no cubierto por ningún finding existente.",
      quote:
        "la cédula de notificación se fijó en un domicilio distinto al señalado por el quejoso",
      source_document_id: null,
      confidence: 0.75,
      new_title: "Nuevo hallazgo",
      new_description: "New finding from the chat exchange.",
    };

    const outcomes = await applyFindingPatchSet(db as never, "case-1", "user-1", [patch], "msg-1");

    expect(outcomes[0]).toMatchObject({
      applied: true,
      action: "create",
      result_finding_id: "finding-new",
    });
    expect(vi.mocked(addFindings)).toHaveBeenCalledTimes(1);
    expect(finding.superseded_at).toBeFalsy();
    expect(patchRows[0]).toMatchObject({
      action: "create",
      finding_id: null,
      result_finding_id: "finding-new",
    });
    // A newly-created finding starts life "active" — addFindings()'s own
    // insert payload can't carry lifecycle_status (not part of
    // NewFinding), so this is the best-effort follow-up write.
    expect(newFinding.lifecycle_status).toBe("active");
  });

  it("a write failure on one patch does not abort the rest of the set", async () => {
    const finding = baseFinding();
    const { db } = makeFakeDb({ findings: [finding] });
    const patches = [
      {
        action: "remove" as const,
        finding_ids: ["finding-missing"],
        reason: "targets a row that doesn't exist",
        quote: "q",
        source_document_id: null,
        confidence: 0.5,
      },
      {
        action: "remove" as const,
        finding_ids: ["finding-1"],
        reason: "real removal",
        quote: "q2",
        source_document_id: null,
        confidence: 0.9,
      },
    ];

    const outcomes = await applyFindingPatchSet(db as never, "case-1", "user-1", patches, "msg-1");

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0].applied).toBe(false);
    expect(outcomes[0].skip_reason).toBe("write_failed");
    expect(outcomes[1].applied).toBe(true);
    expect(finding.superseded_at).toBeTruthy();
  });

  it("'dispute_evidence' marks ONE evidence_ref superseded in place — the finding survives, and the SAME document cited by a different finding is untouched", async () => {
    const disputedFinding = baseFinding({
      id: "finding-disputed",
      evidence_refs: [
        { doc_id: "doc-bad", quote: "wrong reading of the record" },
        { doc_id: "doc-other", quote: "unrelated corroborating quote" },
      ],
    });
    // The SAME doc-bad document is also cited (correctly) by a different
    // finding — disputing it for finding-disputed must never touch this one.
    const otherFinding = baseFinding({
      id: "finding-elsewhere",
      evidence_refs: [{ doc_id: "doc-bad", quote: "a completely different, valid citation" }],
    });
    const { db } = makeFakeDb({ findings: [disputedFinding, otherFinding] });
    const patch = {
      action: "dispute_evidence" as const,
      finding_ids: ["finding-disputed"],
      reason: "El documento no acredita lo que el hallazgo afirma.",
      quote: "grounding quote",
      source_document_id: "doc-replacement",
      confidence: 0.85,
      disputed_doc_id: "doc-bad",
      dispute_status: "superseded" as const,
    };

    const outcomes = await applyFindingPatchSet(db as never, "case-1", "user-1", [patch], "msg-1");

    expect(outcomes[0]).toMatchObject({
      applied: true,
      action: "dispute_evidence",
      result_finding_id: "finding-disputed",
    });
    // Finding itself survives, not superseded — but IS challenged.
    expect(disputedFinding.superseded_at).toBeFalsy();
    expect(disputedFinding.lifecycle_status).toBe("challenged");
    const refs = disputedFinding.evidence_refs as Array<Record<string, unknown>>;
    const disputedRef = refs.find((r) => r.doc_id === "doc-bad");
    expect(disputedRef?.status).toBe("superseded");
    expect(disputedRef?.superseded_by_doc_id).toBe("doc-replacement");
    // The OTHER evidence_ref on the same finding is untouched.
    const otherRef = refs.find((r) => r.doc_id === "doc-other");
    expect(otherRef?.status ?? "active").not.toBe("superseded");
    // A new active ref for the replacement was appended.
    expect(refs.some((r) => r.doc_id === "doc-replacement" && r.status === "active")).toBe(true);
    // The SAME document cited by a DIFFERENT finding is completely untouched
    // — a document can be wrong for one proposition without being globally
    // discarded.
    const otherFindingRefs = otherFinding.evidence_refs as Array<Record<string, unknown>>;
    expect(otherFindingRefs[0].status).toBeUndefined();
  });

  it("'dispute_evidence' fails closed when the disputed_doc_id isn't actually cited by the target finding", async () => {
    const finding = baseFinding({ evidence_refs: [{ doc_id: "doc-real", quote: "q" }] });
    const { db } = makeFakeDb({ findings: [finding] });
    const patch = {
      action: "dispute_evidence" as const,
      finding_ids: ["finding-1"],
      reason: "reason",
      quote: "q",
      source_document_id: null,
      confidence: 0.5,
      disputed_doc_id: "doc-never-cited",
      dispute_status: "disputed" as const,
    };

    const outcomes = await applyFindingPatchSet(db as never, "case-1", "user-1", [patch], "msg-1");
    expect(outcomes[0].applied).toBe(false);
    expect(outcomes[0].skip_reason).toBe("write_failed");
    expect((finding.evidence_refs as Array<Record<string, unknown>>)[0].status).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computeCorrectionImpact / findStaleCitations — dependency-graph raw
// material reused from existing columns (case_findings.related_finding_ids/
// canonical_finding_id, case_scores/case_opportunities.source_finding_ids,
// reports.citations[].finding_id), not a new graph schema. Generic
// query-builder fake: every case_findings/case_scores/case_opportunities/
// reports call in these two functions is a plain filtered SELECT (eq/in/is/
// not, then awaited or .maybeSingle()'d), so one predicate-accumulating
// builder serves all of them — the real behavior a stricter per-shape mock
// would have to hand-replicate per call site anyway.
// ---------------------------------------------------------------------------
function queryBuilder(rows: Array<Record<string, unknown>>) {
  let predicate = (_r: Record<string, unknown>) => true;
  const self: Record<string, unknown> = {
    select: () => self,
    eq: (col: string, val: unknown) => {
      const prev = predicate;
      predicate = (r) => prev(r) && r[col] === val;
      return self;
    },
    in: (col: string, vals: unknown[]) => {
      const prev = predicate;
      predicate = (r) => prev(r) && vals.includes(r[col]);
      return self;
    },
    is: (col: string, val: null) => {
      const prev = predicate;
      predicate = (r) => prev(r) && ((r[col] as unknown) ?? null) === val;
      return self;
    },
    not: (col: string, _op: string, val: null) => {
      const prev = predicate;
      predicate = (r) => prev(r) && ((r[col] as unknown) ?? null) !== val;
      return self;
    },
    neq: (col: string, val: unknown) => {
      const prev = predicate;
      predicate = (r) => prev(r) && r[col] !== val;
      return self;
    },
    maybeSingle: () => Promise.resolve({ data: rows.filter(predicate)[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ data: rows.filter(predicate), error: null }),
  };
  return self;
}

function makeImpactFakeDb(opts: {
  findings?: Array<Record<string, unknown>>;
  scores?: Array<Record<string, unknown>>;
  opportunities?: Array<Record<string, unknown>>;
  reports?: Array<Record<string, unknown>>;
}) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    case_findings: opts.findings ?? [],
    case_scores: opts.scores ?? [],
    case_opportunities: opts.opportunities ?? [],
    reports: opts.reports ?? [],
  };
  return {
    from(table: string) {
      if (table in tables) return queryBuilder(tables[table]);
      throw new Error(`unexpected table in impact fake db: ${table}`);
    },
  };
}

describe("computeCorrectionImpact", () => {
  it("returns all-empty/false when the patch set targets no findings", async () => {
    const db = makeImpactFakeDb({});
    const impact = await computeCorrectionImpact(db as never, "case-1", []);
    expect(impact).toEqual({
      dependentFindingIds: [],
      scoreAffected: false,
      affectedOpportunityIds: [],
      affectedCitationCount: 0,
    });
  });

  it("finds a dependent finding via related_finding_ids, a scoreAffected via case_scores.source_finding_ids, an affected opportunity, and a citation count — while a wholly unrelated finding is never flagged", async () => {
    const changed = {
      id: "finding-A",
      case_id: "case-1",
      canonical_finding_id: "canon-A",
      superseded_at: null,
    };
    const dependent = {
      id: "finding-B",
      case_id: "case-1",
      related_finding_ids: ["finding-A"],
      canonical_finding_id: "canon-B",
      superseded_at: null,
    };
    const unrelated = {
      id: "finding-C",
      case_id: "case-1",
      related_finding_ids: [],
      canonical_finding_id: "canon-C",
      superseded_at: null,
    };
    const db = makeImpactFakeDb({
      findings: [changed, dependent, unrelated],
      scores: [{ case_id: "case-1", source_finding_ids: ["finding-A", "finding-C"] }],
      opportunities: [
        { id: "opp-1", case_id: "case-1", source_finding_ids: ["finding-A"] },
        { id: "opp-2", case_id: "case-1", source_finding_ids: ["finding-C"] },
      ],
      reports: [
        {
          case_id: "case-1",
          citations: [
            { id: "c1", finding_id: "finding-A" },
            { id: "c2", finding_id: "finding-A" },
            { id: "c3", finding_id: "finding-C" },
          ],
        },
      ],
    });

    const impact = await computeCorrectionImpact(db as never, "case-1", [
      {
        action: "remove",
        finding_ids: ["finding-A"],
        reason: "r",
        quote: "q",
        source_document_id: null,
        confidence: 0.9,
      },
    ]);

    expect(impact.dependentFindingIds).toEqual(["finding-B"]);
    expect(impact.dependentFindingIds).not.toContain("finding-C");
    expect(impact.scoreAffected).toBe(true);
    expect(impact.affectedOpportunityIds).toEqual(["opp-1"]);
    expect(impact.affectedOpportunityIds).not.toContain("opp-2");
    expect(impact.affectedCitationCount).toBe(2);
  });

  it("finds a dependent finding sharing the SAME canonical_finding_id even with no explicit related_finding_ids link", async () => {
    const changed = {
      id: "finding-A",
      case_id: "case-1",
      canonical_finding_id: "canon-shared",
      superseded_at: null,
    };
    const sameClaim = {
      id: "finding-B",
      case_id: "case-1",
      related_finding_ids: [],
      canonical_finding_id: "canon-shared",
      superseded_at: null,
    };
    const db = makeImpactFakeDb({ findings: [changed, sameClaim] });

    const impact = await computeCorrectionImpact(db as never, "case-1", [
      {
        action: "remove",
        finding_ids: ["finding-A"],
        reason: "r",
        quote: "q",
        source_document_id: null,
        confidence: 0.9,
      },
    ]);

    expect(impact.dependentFindingIds).toEqual(["finding-B"]);
  });
});

describe("findStaleCitations", () => {
  it("returns nothing when no changed finding is actually superseded (an amend/dispute keeps the same active id)", async () => {
    const amended = { id: "finding-A", case_id: "case-1", superseded_at: null };
    const db = makeImpactFakeDb({
      findings: [amended],
      reports: [
        { case_id: "case-1", citations: [{ id: "c1", finding_id: "finding-A", quote: "q" }] },
      ],
    });
    const stale = await findStaleCitations(db as never, "case-1", ["finding-A"]);
    expect(stale).toEqual([]);
  });

  it("flags a report citation still referencing a finding that was just superseded", async () => {
    const removed = {
      id: "finding-A",
      case_id: "case-1",
      superseded_at: "2026-08-13T00:00:00.000Z",
    };
    const db = makeImpactFakeDb({
      findings: [removed],
      reports: [
        {
          case_id: "case-1",
          citations: [
            {
              id: "c1",
              finding_id: "finding-A",
              quote: "stale quote",
              document_id: "doc-1",
              page: 4,
            },
            { id: "c2", finding_id: "finding-other", quote: "unaffected" },
          ],
        },
      ],
    });
    const stale = await findStaleCitations(db as never, "case-1", ["finding-A"]);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({
      citationId: "c1",
      findingId: "finding-A",
      quote: "stale quote",
      documentId: "doc-1",
      page: 4,
    });
  });

  it("returns nothing for an empty changed-findings list", async () => {
    const db = makeImpactFakeDb({});
    const stale = await findStaleCitations(db as never, "case-1", []);
    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// recordLesson — Continuous Legal Intelligence's learning ledger (see
// migration 20260813232206_intelligence_lessons.sql). Every lesson must
// trace back to a real applied case_finding_patches row, must never be
// written for a patch that failed to apply, must always start at
// 'ai_supported' (never self-promoted), and must never carry legal
// authority CONTENT — only ids, which Phase A doesn't populate yet, so
// authority_refs is asserted empty.
// ---------------------------------------------------------------------------
describe("recordLesson", () => {
  it("writes exactly one lesson at 'ai_supported' for an applied, grounded correction", async () => {
    const finding = baseFinding({ canonical_finding_id: "canon-1" });
    const { db, lessonRows } = makeFakeDb({ findings: [finding] });
    const patch = {
      action: "remove" as const,
      finding_ids: ["finding-1"],
      reason: "La notificación sí fue correcta.",
      quote: "grounding quote",
      source_document_id: null,
      confidence: 0.9,
      error_type: "false_positive" as const,
    };
    const [outcome] = await applyFindingPatchSet(db as never, "case-1", "user-1", [patch], "msg-1");

    await recordLesson(db as never, "case-1", "user-1", patch, outcome, "amparo_directo", "MX");

    expect(lessonRows).toHaveLength(1);
    expect(lessonRows[0]).toMatchObject({
      case_id: "case-1",
      user_id: "user-1",
      source_patch_id: outcome.auditRowId,
      canonical_finding_id: "canon-1",
      matter_type: "amparo_directo",
      jurisdiction_country: "MX",
      error_type: "false_positive",
      validation_status: "ai_supported",
      original_claim: "Notificación defectuosa del auto de radicación",
    });
    // Never legal authority content — ids only, and Phase A doesn't
    // populate even those yet.
    expect(lessonRows[0].authority_refs).toEqual([]);
  });

  it("writes nothing for a patch that failed to apply", async () => {
    const { db, lessonRows } = makeFakeDb({ findings: [] });
    const patch = {
      action: "remove" as const,
      finding_ids: ["finding-does-not-exist"],
      reason: "reason",
      quote: "q",
      source_document_id: null,
      confidence: 0.5,
    };
    const [outcome] = await applyFindingPatchSet(db as never, "case-1", "user-1", [patch], "msg-1");
    expect(outcome.applied).toBe(false);

    await recordLesson(db as never, "case-1", "user-1", patch, outcome, null, "MX");

    expect(lessonRows).toHaveLength(0);
  });

  it("records original_claim as the pre-correction title for 'amend', and corrected_claim as the new title", async () => {
    const finding = baseFinding();
    const { db, lessonRows } = makeFakeDb({ findings: [finding] });
    const patch = {
      action: "amend" as const,
      finding_ids: ["finding-1"],
      reason: "El defecto real es distinto.",
      quote:
        "la cédula de notificación se fijó en un domicilio distinto al señalado por el quejoso",
      source_document_id: null,
      confidence: 0.8,
      new_title: "Corrected title",
      new_description: "Corrected description.",
      error_type: "wrong_evidence_interpretation" as const,
    };
    const [outcome] = await applyFindingPatchSet(db as never, "case-1", "user-1", [patch], "msg-1");

    await recordLesson(db as never, "case-1", "user-1", patch, outcome, null, "MX");

    expect(lessonRows[0]).toMatchObject({
      original_claim: "Notificación defectuosa del auto de radicación",
      corrected_claim: "Corrected title",
      error_type: "wrong_evidence_interpretation",
    });
  });

  it("uses a placeholder original_claim for 'create' — nothing existed before", async () => {
    const finding = baseFinding();
    const newFinding = baseFinding({ id: "finding-new" });
    const { db, lessonRows } = makeFakeDb({ findings: [finding, newFinding] });
    vi.mocked(addFindings).mockResolvedValue([{ id: "finding-new" }] as never);
    const patch = {
      action: "create" as const,
      finding_ids: [],
      reason: "Genuinely new issue the exchange revealed.",
      quote:
        "la cédula de notificación se fijó en un domicilio distinto al señalado por el quejoso",
      source_document_id: null,
      confidence: 0.7,
      new_title: "New finding",
      new_description: "New finding description.",
    };
    const [outcome] = await applyFindingPatchSet(db as never, "case-1", "user-1", [patch], "msg-1");

    await recordLesson(db as never, "case-1", "user-1", patch, outcome, null, "MX");

    expect(lessonRows[0]).toMatchObject({
      original_claim: "(no prior finding — newly created)",
      corrected_claim: "New finding",
      // "create" is not a correction of a prior error — error_type was
      // never asked of the LLM for this action and must stay unset.
      error_type: null,
    });
  });

  it("never emits error_type for a well-formed 'merge' patch — only remove/amend/dispute_evidence correct a prior error", async () => {
    const findingA = baseFinding({ id: "finding-A" });
    const findingB = baseFinding({ id: "finding-B" });
    const { db } = makeFakeDb({ findings: [findingA, findingB] });
    mockPatchLlmResponse([
      {
        action: "merge",
        finding_ids: ["finding-A", "finding-B"],
        reason: "Son el mismo defecto de notificación descrito dos veces.",
        quote:
          "la cédula de notificación se fijó en un domicilio distinto al señalado por el quejoso",
        confidence: 0.8,
        new_title: "Consolidated",
        new_description: "Consolidated description.",
        // The model should not be asked to classify error_type for a
        // merge (it doesn't correct a prior error, it consolidates), but
        // even if it echoes one back, the parsing loop must strip it.
        error_type: "false_positive",
      },
    ]);

    const result = await generateFindingPatchSet(
      db as never,
      "case-error-type-scope",
      "user-1",
      EXCHANGE,
    );

    expect(result.patches).toHaveLength(1);
    expect(result.patches[0].error_type).toBeUndefined();
  });
});

describe("document purpose classification", () => {
  it("writes documents.purpose only once the patch citing it has been approved and applied", async () => {
    const finding = baseFinding({
      evidence_refs: [{ doc_id: "doc-1", quote: "original evidence quote" }],
    });
    const doc = { id: "doc-new", case_id: "case-1", purpose: null as string | null };
    const { db, documentUpdates } = makeFakeDb({ findings: [finding], documents: [doc] });
    const patch = {
      action: "amend" as const,
      finding_ids: ["finding-1"],
      reason: "El documento adjunto corrige la fecha.",
      quote:
        "la cédula de notificación se fijó en un domicilio distinto al señalado por el quejoso",
      source_document_id: "doc-new",
      confidence: 0.8,
      new_title: "Corrected title",
      new_description: "Corrected description.",
      source_document_purpose: "correction_support" as const,
    };

    await applyFindingPatchSet(db as never, "case-1", "user-1", [patch], "msg-1");

    expect(documentUpdates).toHaveLength(1);
    expect(documentUpdates[0]).toMatchObject({
      id: "doc-new",
      payload: { purpose: "correction_support" },
    });
    expect(doc.purpose).toBe("correction_support");
  });

  it("writes nothing to documents when a patch has no source_document_purpose", async () => {
    const finding = baseFinding();
    const { db, documentUpdates } = makeFakeDb({ findings: [finding] });
    const patch = {
      action: "remove" as const,
      finding_ids: ["finding-1"],
      reason: "reason",
      quote: "q",
      source_document_id: null,
      confidence: 0.5,
    };

    await applyFindingPatchSet(db as never, "case-1", "user-1", [patch], "msg-1");

    expect(documentUpdates).toHaveLength(0);
  });
});
