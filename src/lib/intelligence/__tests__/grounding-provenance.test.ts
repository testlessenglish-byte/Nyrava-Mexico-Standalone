// Tests for the Phase 1 evidence-provenance integration into
// grounding.server.ts — verifyEvidenceRefs() now locates the exact
// character offset of a verified quote within its true source document
// (not just "somewhere in the corpus"), attaches a document hash and a
// deterministic citation hash, and corrects a citation's document_id when
// the LLM attributed a quote to the wrong document.
import { describe, it, expect } from "vitest";
import { buildGroundingCorpus, verifyEvidenceRefs, groundItems } from "@/lib/intelligence/grounding.server";

const corpus = buildGroundingCorpus([
  {
    id: "doc-A",
    filename: "contrato.pdf",
    extracted_text:
      "CONTRATO DE ARRENDAMIENTO. El arrendador José Pérez entrega en arrendamiento el inmueble al arrendatario.",
  },
  {
    id: "doc-B",
    filename: "demanda.pdf",
    extracted_text:
      "DEMANDA. La parte actora manifiesta que el incumplimiento contractual se produjo el 15 de marzo de 2026.",
  },
]);

describe("verifyEvidenceRefs — character-offset location", () => {
  it("attaches the exact start/end offset for a quote correctly attributed to doc_n 1", () => {
    const [v] = verifyEvidenceRefs([{ doc_n: 1, quote: "El arrendador José Pérez entrega en arrendamiento" }], corpus);
    expect(v).toBeDefined();
    expect(v.document_id).toBe("doc-A");
    expect(v.start_offset).not.toBeNull();
    expect(v.end_offset).not.toBeNull();
    expect(v.source_reattributed).toBe(false);
  });

  it("attaches a document_hash and a citation_hash when the quote is exactly located", () => {
    const [v] = verifyEvidenceRefs([{ doc_n: 2, quote: "el incumplimiento contractual se produjo el 15 de marzo de 2026" }], corpus);
    expect(v.document_hash).toBeTruthy();
    expect(v.document_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(v.citation_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("re-attributes the citation to the document that actually contains the quote when doc_n is wrong", () => {
    // Quote is really in doc-B, but the citation claims doc_n 1 (doc-A).
    const [v] = verifyEvidenceRefs(
      [{ doc_n: 1, quote: "La parte actora manifiesta que el incumplimiento contractual" }],
      corpus,
    );
    expect(v).toBeDefined();
    expect(v.document_id).toBe("doc-B");
    expect(v.source_reattributed).toBe(true);
  });

  it("does not flag source_reattributed for a citation with no doc_n at all that resolves via corpus-wide search", () => {
    const [v] = verifyEvidenceRefs([{ quote: "el arrendador José Pérez entrega" }], corpus);
    expect(v.document_id).toBe("doc-A");
    // No doc_n/document_id was ever claimed, so there is nothing to have
    // been "wrong" about — this is a first attribution, not a correction.
    expect(v.source_reattributed).toBe(false);
  });

  it("leaves offsets null (never fabricated) for a citation that only verifies via the soft/shingle fuzzy path", () => {
    // Deliberately garble word order so it can't be an exact contiguous
    // substring match, but still passes grounding's token-overlap fuzzy
    // check (same corpus vocabulary, different order).
    const [v] = verifyEvidenceRefs(
      [{ doc_n: 1, quote: "José Pérez arrendador el arrendamiento entrega" }],
      corpus,
    );
    if (v) {
      // If grounding's fuzzy match accepted it, there must be no fabricated
      // offset for a span that isn't actually contiguous in the source.
      expect(v.start_offset).toBeNull();
      expect(v.end_offset).toBeNull();
      expect(v.page_located).toBeNull();
      // citation_hash must still be well-defined even with null offsets.
      expect(v.citation_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("drops a citation whose quote does not exist anywhere in the corpus", () => {
    const out = verifyEvidenceRefs([{ doc_n: 1, quote: "esta frase jamás aparece en ningún documento del expediente" }], corpus);
    expect(out).toHaveLength(0);
  });
});

describe("groundItems — provenance flows through to the caller-facing shape", () => {
  it("carries offsets, hashes, and source_reattributed into provenance.sources", () => {
    const [item] = groundItems(
      [
        {
          title: "Cláusula de arrendamiento",
          confidence: 0.9,
          evidence_refs: [{ doc_n: 1, quote: "El arrendador José Pérez entrega en arrendamiento" }],
        },
      ],
      corpus,
    );
    expect(item).toBeDefined();
    const [source] = item.provenance.sources;
    expect(source.document_id).toBe("doc-A");
    expect(source.start_offset).not.toBeNull();
    expect(source.citation_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(source.source_reattributed).toBe(false);
  });
});
