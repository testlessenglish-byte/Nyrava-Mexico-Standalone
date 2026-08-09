// Regression test for "FIX THE TALK TO CASE → REPORT REWRITE": a Talk-to-Case
// clarification was ingested as just another document, so contradictory
// findings from BEFORE the clarification could keep sitting in
// case_findings, unmarked, right next to a fresh finding drawn from the
// clarification that said the opposite — the report read as the original
// analysis with new findings appended, not one internally-consistent
// re-analysis.
//
// Modeled directly on the real reported scenario: a finding titled "Interés
// jurídico o legítimo no identificado en el corpus" (Matter 3E87F221 —
// Amparo Directo en Revisión 3684/2012) that a Talk-to-Case clarification
// resolves. Proves the critical-test sequence end to end:
//   Original Report (finding present, active)
//     → Talk to Case correction (clarification document + reconciliation)
//     → Case State Update (superseded_at set, never deleted — audit trail)
//     → Full Report Rewrite (listFindings — the report's own read path —
//       no longer returns the stale finding)
//
// callGroq is mocked (this is the one call site in this codebase that
// legitimately needs an LLM to judge semantic supersession — see
// case-state-reconciliation.server.ts's module doc comment for why this
// can't be fully deterministic), but nothing else is: the actual grounding
// verification (a decision is only applied when its quote independently
// re-locates in the clarification document's own text) and the actual
// listFindings() exclusion are both exercised for real.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/groq.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/groq.server")>();
  return { ...actual, callGroq: vi.fn() };
});

import { callGroq } from "@/lib/groq.server";
import {
  hasCaseStateUpdateDocs,
  getCaseStateUpdateNotice,
  reconcileSupersededFindings,
  CASE_STATE_UPDATE_FILENAME_PREFIX,
} from "@/lib/intelligence/case-state-reconciliation.server";
import { listFindings } from "@/lib/intelligence/findings.server";

beforeEach(() => {
  vi.mocked(callGroq).mockReset();
});

describe("hasCaseStateUpdateDocs", () => {
  it("detects a Talk-to-Case clarification document by its stable filename convention", () => {
    expect(
      hasCaseStateUpdateDocs([
        { id: "d1", filename: "sentencia.pdf", extracted_text: "..." },
        {
          id: "d2",
          filename: `${CASE_STATE_UPDATE_FILENAME_PREFIX}1699999999.txt`,
          extracted_text: "...",
        },
      ]),
    ).toBe(true);
  });

  it("is false when no clarification document exists", () => {
    expect(
      hasCaseStateUpdateDocs([{ id: "d1", filename: "sentencia.pdf", extracted_text: "..." }]),
    ).toBe(false);
  });
});

describe("getCaseStateUpdateNotice", () => {
  it("is a no-op (null) when there are no case-state updates", () => {
    expect(getCaseStateUpdateNotice(false, "es")).toBeNull();
  });

  it("instructs reconciliation, not duplication, in both locales", () => {
    const es = getCaseStateUpdateNotice(true, "es");
    expect(es).toMatch(/ACTUALIZACIÓN DE ESTADO DEL CASO/);
    expect(es).toMatch(/no un apéndice/);
    const en = getCaseStateUpdateNotice(true, "en");
    expect(en).toMatch(/CASE STATE UPDATE/);
    expect(en).toMatch(/not an appendix/);
  });
});

const CLARIFICATION_TEXT =
  "El quejoso Jesús López Castro cuenta con interés jurídico acreditado: fue parte directamente afectada " +
  "por la orden de aprehensión dictada en su contra, según consta en el auto de radicación adjunto a esta " +
  "aclaración. El interés jurídico y la tutela judicial efectiva quedan establecidos con este documento.";

const ORIGINAL_FINDING = {
  id: "finding-interes-juridico",
  case_id: "case-3e87f221",
  user_id: "user-1",
  source_module: "engine:jurisdiction_intel",
  category: "standing",
  title: "Interés jurídico o legítimo no identificado en el corpus",
  description:
    "No se localizó en el corpus documental evidencia que acredite el interés jurídico del quejoso.",
  severity: "medium" as const,
  confidence: 0.6,
  legal_significance: null,
  potential_impact: null,
  affected_party: null,
  audit_classification: "NOT_FOUND",
  superseded_at: null as string | null,
  superseded_reason: null as string | null,
  source_doc_ids: [],
  evidence_refs: [],
  related_finding_ids: [],
  tags: [],
  metadata: {},
  created_at: "2026-08-09T14:25:00.000Z",
  updated_at: "2026-08-09T14:25:00.000Z",
};

function makeFakeDb(opts: {
  clarificationText: string;
  findings: Array<Record<string, unknown>>;
  /** Set to simulate a case with no clarification document uploaded yet. */
  noClarificationDoc?: boolean;
}) {
  function findingsChain() {
    // Mirrors listFindings()'s real chain: select().eq().not().order().order()
    // then (in the real function) an appended .is("superseded_at", null).
    // Every filter step returns `self` so any call order/depth works, and
    // resolving (via `then` or `.is`) always re-reads live state so a prior
    // .update() in this same test is reflected on the next read — exactly
    // what proves the "before/after" sequence below.
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

  const documentsResult = opts.noClarificationDoc
    ? [{ id: "doc-1", filename: "sentencia.pdf", extracted_text: "..." }]
    : [
        {
          id: "doc-clarify",
          filename: `${CASE_STATE_UPDATE_FILENAME_PREFIX}1699999999.txt`,
          extracted_text: opts.clarificationText,
        },
      ];

  return {
    from(table: string) {
      if (table === "documents") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: documentsResult, error: null }),
            }),
          }),
        };
      }
      if (table === "case_findings") {
        return {
          select: () => findingsChain(),
          // Mirrors the real call: .update({...}).eq("id", finding_id).eq("case_id", caseId).
          update: (payload: Record<string, unknown>) => ({
            eq: (col1: string, id: string) => ({
              eq: () => {
                if (col1 === "id") {
                  const row = opts.findings.find((f) => f.id === id);
                  if (row) Object.assign(row, payload);
                }
                return Promise.resolve({ error: null });
              },
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
      throw new Error(`unexpected table in fake db: ${table}`);
    },
  };
}

describe("Original Report → Talk to Case correction → Case State Update → Full Report Rewrite", () => {
  it("supersedes the stale finding once a clarification resolves it, and the report's own read path (listFindings) stops returning it — without deleting the audit trail", async () => {
    const findings = [{ ...ORIGINAL_FINDING }];
    const db = makeFakeDb({ clarificationText: CLARIFICATION_TEXT, findings });

    // ---- Original Report: the finding is present and active -------------
    const before = await listFindings(db as never, "case-3e87f221");
    expect(before).toHaveLength(1);
    expect(before[0].title).toBe("Interés jurídico o legítimo no identificado en el corpus");

    // ---- Talk to Case correction + Case State Update ---------------------
    // The clarification text really does contain this exact quote — that's
    // what makes the supersession GROUNDED, not just asserted by the model.
    const quote =
      "El quejoso Jesús López Castro cuenta con interés jurídico acreditado: fue parte directamente afectada " +
      "por la orden de aprehensión dictada en su contra";
    vi.mocked(callGroq).mockResolvedValue({
      text: JSON.stringify({
        supersessions: [
          {
            finding_id: "finding-interes-juridico",
            reason: "El abogado aclaró que el interés jurídico del quejoso está acreditado.",
            quote,
          },
        ],
      }),
      latencyMs: 10,
      model: "test-model",
      provider: "groq",
    } as never);

    const result = await reconcileSupersededFindings(db as never, "case-3e87f221", "user-1");
    expect(result.ran).toBe(true);
    expect(result.superseded).toEqual(["finding-interes-juridico"]);
    expect(result.skipped_ungrounded).toEqual([]);

    // ---- Case State Update: audit trail preserved, row never deleted -----
    expect(findings[0].superseded_at).toBeTruthy();
    expect(String(findings[0].superseded_reason)).toContain(quote);

    // ---- Full Report Rewrite: the report's own read path (listFindings) --
    // no longer returns the stale finding — proving it disappears from what
    // actually matters (the generated report), not just from a side table.
    const after = await listFindings(db as never, "case-3e87f221");
    expect(after).toHaveLength(0);
  });

  it("never applies a supersession whose quote does not actually appear in the clarification — an unverified model claim is discarded, not trusted", async () => {
    const findings = [{ ...ORIGINAL_FINDING, id: "finding-other" }];
    const db = makeFakeDb({ clarificationText: CLARIFICATION_TEXT, findings });

    vi.mocked(callGroq).mockResolvedValue({
      text: JSON.stringify({
        supersessions: [
          {
            finding_id: "finding-other",
            reason: "Invented justification.",
            quote:
              "This exact sentence does not appear anywhere in the clarification and was invented.",
          },
        ],
      }),
      latencyMs: 10,
      model: "test-model",
      provider: "groq",
    } as never);

    const result = await reconcileSupersededFindings(db as never, "case-3e87f221", "user-1");
    expect(result.superseded).toEqual([]);
    expect(result.skipped_ungrounded).toEqual(["finding-other"]);
    expect(findings[0].superseded_at).toBeFalsy();

    const after = await listFindings(db as never, "case-3e87f221");
    expect(after).toHaveLength(1);
  });

  it("never supersedes a finding id the model invented — only ids from the active findings list are eligible", async () => {
    const findings = [{ ...ORIGINAL_FINDING, id: "finding-real" }];
    const db = makeFakeDb({ clarificationText: CLARIFICATION_TEXT, findings });

    vi.mocked(callGroq).mockResolvedValue({
      text: JSON.stringify({
        supersessions: [
          {
            finding_id: "finding-does-not-exist",
            reason: "Hallucinated id.",
            quote: CLARIFICATION_TEXT.slice(0, 40),
          },
        ],
      }),
      latencyMs: 10,
      model: "test-model",
      provider: "groq",
    } as never);

    const result = await reconcileSupersededFindings(db as never, "case-3e87f221", "user-1");
    expect(result.superseded).toEqual([]);
    expect(findings[0].superseded_at).toBeFalsy();
  });

  it("is a no-op when the case has no Talk-to-Case clarification document", async () => {
    const db = makeFakeDb({
      clarificationText: "",
      findings: [{ ...ORIGINAL_FINDING }],
      noClarificationDoc: true,
    });

    const result = await reconcileSupersededFindings(db as never, "case-3e87f221", "user-1");
    expect(result.ran).toBe(false);
    expect(callGroq).not.toHaveBeenCalled();
  });
});
