// Citation floor — a finding tagged DIRECT_EVIDENCE at persistence must
// carry BOTH a source_quote and a source_document_id. When either is
// missing, findings.server.ts downgrades the finding_type before insert.
// This test locks the invariant without hitting the database — it exercises
// the payload-mapping logic that runs inside addFindings.
import { describe, it, expect } from "vitest";

// Replicate the citation-floor rule that lives inline in addFindings so we
// have a regression test independent of the (async, DB-bound) function.
function resolveFindingType(input: {
  declaredType?: string;
  evidence_refs?: Array<{ quote?: string; doc_id?: string; document_id?: string }>;
  source_quote?: string | null;
  source_document_id?: string | null;
  source_doc_ids?: string[];
}): string {
  const ev = input.evidence_refs ?? [];
  const primaryQuote = ev.find((e) => typeof e.quote === "string" && e.quote.length > 0)?.quote ?? null;
  const primaryDocId =
    ev.find((e) => typeof (e.document_id ?? e.doc_id) === "string")?.document_id
    ?? ev.find((e) => typeof e.doc_id === "string")?.doc_id
    ?? (input.source_doc_ids?.[0] ?? null);
  const declaredType = input.declaredType ?? (primaryQuote ? "DIRECT_EVIDENCE" : "AI_THEORY");
  const resolvedQuote = input.source_quote ?? primaryQuote;
  const resolvedDocId = input.source_document_id ?? primaryDocId;
  const hasCompleteCitation = !!resolvedQuote && !!resolvedDocId;
  return declaredType === "DIRECT_EVIDENCE" && !hasCompleteCitation
    ? "EVIDENCE_BASED_INFERENCE"
    : declaredType;
}

describe("citation floor at persistence", () => {
  it("DIRECT_EVIDENCE with both quote and doc_id is preserved", () => {
    expect(
      resolveFindingType({
        declaredType: "DIRECT_EVIDENCE",
        evidence_refs: [{ quote: "warranty is void", doc_id: "doc-1" }],
      }),
    ).toBe("DIRECT_EVIDENCE");
  });

  it("DIRECT_EVIDENCE without a quote is downgraded", () => {
    expect(
      resolveFindingType({
        declaredType: "DIRECT_EVIDENCE",
        evidence_refs: [{ doc_id: "doc-1" }],
      }),
    ).toBe("EVIDENCE_BASED_INFERENCE");
  });

  it("DIRECT_EVIDENCE without a doc_id is downgraded", () => {
    expect(
      resolveFindingType({
        declaredType: "DIRECT_EVIDENCE",
        evidence_refs: [{ quote: "the check was returned" }],
      }),
    ).toBe("EVIDENCE_BASED_INFERENCE");
  });

  it("AI_THEORY / EVIDENCE_BASED_INFERENCE are not touched", () => {
    expect(resolveFindingType({ declaredType: "AI_THEORY" })).toBe("AI_THEORY");
    expect(
      resolveFindingType({
        declaredType: "EVIDENCE_BASED_INFERENCE",
        evidence_refs: [{ quote: "x", doc_id: "d" }],
      }),
    ).toBe("EVIDENCE_BASED_INFERENCE");
  });

  it("Default inference: quote present → DIRECT_EVIDENCE only when doc_id also resolvable", () => {
    // Quote in refs but no doc anywhere → downgrade
    expect(
      resolveFindingType({
        evidence_refs: [{ quote: "hello" }],
      }),
    ).toBe("EVIDENCE_BASED_INFERENCE");
    // Quote AND doc_id present (via source_doc_ids fallback) → allowed
    expect(
      resolveFindingType({
        evidence_refs: [{ quote: "hello" }],
        source_doc_ids: ["doc-9"],
      }),
    ).toBe("DIRECT_EVIDENCE");
  });
});
