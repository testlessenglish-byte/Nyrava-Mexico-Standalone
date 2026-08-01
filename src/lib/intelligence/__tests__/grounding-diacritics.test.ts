// Regression test for the diacritic-normalization gap in grounding.server.ts.
//
// Root cause: norm() stripped any character outside [a-z0-9'"$.%/] to a
// space, INCLUDING accented Spanish characters (á é í ó ú ñ ü), without
// first folding them to their base letter. Since verifyQuoteDetailed()
// does a substring check of norm(quote) against norm(corpus), any citation
// where the accent is present/absent/typed differently between the LLM's
// quote and the source document text (extremely common for Spanish-language
// legal documents — names, "número", "artículo", "cláusula", "público",
// "según", etc.) silently failed verification and was dropped by
// addGatedFindings, even though the citation was substantively correct.
//
// This is not tied to any specific case, party, or document — it exercises
// the normalizer directly with generic Spanish text.
import { describe, it, expect } from "vitest";
import { buildGroundingCorpus, verifyQuoteDetailed, verifyQuote } from "@/lib/intelligence/grounding.server";

describe("grounding.server diacritic handling", () => {
  const corpus = buildGroundingCorpus([
    {
      id: "doc-1",
      filename: "generic.txt",
      extracted_text:
        "El inmueble ubicado en el número 42, propiedad del señor José Antonio " +
        "Pérez Chan, según escritura pública número 18,742, cuenta con una " +
        "cláusula de garantía hipotecaria a favor del acreedor.",
    },
  ]);

  it("verifies a quote that preserves the original accents exactly", () => {
    const v = verifyQuoteDetailed("José Antonio Pérez Chan", corpus);
    expect(v.verified).toBe(true);
  });

  it("verifies a quote where diacritics were dropped by the LLM (accent-free retyping)", () => {
    // This is the actual failure mode: a model producing a "verbatim" quote
    // often normalizes/ASCII-folds accented characters. The proposition is
    // still correct and should not be silently discarded.
    const v = verifyQuoteDetailed("Jose Antonio Perez Chan", corpus);
    expect(v.verified).toBe(true);
  });

  it("verifies accent-bearing common legal terms regardless of source casing/accent variant", () => {
    expect(verifyQuote("numero 18,742", corpus)).toBe(true);
    expect(verifyQuote("número 18,742", corpus)).toBe(true);
    expect(verifyQuote("clausula de garantia hipotecaria", corpus)).toBe(true);
    expect(verifyQuote("cláusula de garantía hipotecaria", corpus)).toBe(true);
  });

  it("still rejects a quote that is not actually present in the corpus", () => {
    const v = verifyQuoteDetailed("María Fernanda Gómez Villareal never appears here", corpus);
    expect(v.verified).toBe(false);
  });

  it("still rejects quotes shorter than the minimum length regardless of accents", () => {
    const v = verifyQuoteDetailed("José", corpus);
    expect(v.verified).toBe(false);
    expect(v.reason).toBe("quote_too_short");
  });
});
