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
function makeFakeDb(opts: { findings: Array<Record<string, unknown>> }) {
  const patchRows: Array<Record<string, unknown>> = [];
  const touchedTables = new Set<string>();

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
            in: (_col: string, vals: string[]) => ({
              eq: () =>
                Promise.resolve({
                  data: opts.findings.filter((f) => vals.includes(f.id as string)),
                  error: null,
                }),
            }),
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
            patchRows.push(row);
            return Promise.resolve({ error: null });
          },
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

  return { db, patchRows, touchedTables };
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
  });

  it("'create' inserts a brand-new finding via addFindings and never supersedes anything", async () => {
    const finding = baseFinding();
    const { db, patchRows } = makeFakeDb({ findings: [finding] });
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
});
