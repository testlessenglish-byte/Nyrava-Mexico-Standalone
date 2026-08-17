// Pipeline-wide sweep (2026-08-17): case_perspectives.key_evidence explicitly
// claims to describe real evidence in the case ("item"/"why_it_matters") but
// had no citation field at all — unlike motion_opportunities/
// recommended_motions/cross_examination.impeachment_with (all quote-verified
// elsewhere in this codebase), key_evidence was guarded only by
// textMatchesCaseType (terminology), never by real corpus grounding.
// recommended_actions is deliberately left uncited — it's a suggested next
// step, not a factual claim, matching next_actions elsewhere.
import { describe, it, expect } from "vitest";
import { keyEvidenceIsGrounded } from "@/lib/intelligence/litigation.server";
import { buildGroundingCorpus, verifyQuote } from "@/lib/intelligence/grounding.server";

const REAL_TEXT =
  "El contrato de arrendamiento fue firmado por ambas partes el 3 de marzo de 2022 ante notario público.";

const corpus = buildGroundingCorpus([
  { id: "doc-1", filename: "contrato.pdf", extracted_text: REAL_TEXT },
]);

describe("keyEvidenceIsGrounded", () => {
  it("drops a key_evidence entry whose citation is fabricated — never appears in the real corpus", () => {
    const item = {
      item: "Testimonio del testigo ocular",
      why_it_matters: "Corrobora la versión del actor",
      citation: { doc_n: 1, page: 1, quote: "Esta cita no existe en ningún documento real del expediente." },
    };
    expect(keyEvidenceIsGrounded(item, verifyQuote, corpus)).toBe(false);
  });

  it("keeps a key_evidence entry whose citation genuinely verifies against the real corpus", () => {
    const item = {
      item: "Contrato de arrendamiento",
      why_it_matters: "Establece la fecha de inicio de la relación contractual",
      citation: { doc_n: 1, page: 1, quote: REAL_TEXT.slice(0, 50) },
    };
    expect(keyEvidenceIsGrounded(item, verifyQuote, corpus)).toBe(true);
  });

  it("drops an entry with citation: null", () => {
    const item = { item: "x", why_it_matters: "y", citation: null };
    expect(keyEvidenceIsGrounded(item, verifyQuote, corpus)).toBe(false);
  });

  it("drops an entry with no citation field at all", () => {
    const item = { item: "x", why_it_matters: "y" };
    expect(keyEvidenceIsGrounded(item, verifyQuote, corpus)).toBe(false);
  });

  it("drops a non-object item", () => {
    expect(keyEvidenceIsGrounded(null, verifyQuote, corpus)).toBe(false);
    expect(keyEvidenceIsGrounded("x", verifyQuote, corpus)).toBe(false);
  });
});
