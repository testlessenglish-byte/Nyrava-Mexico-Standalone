// Regression tests for isLegalAuthorityCitation, traced from a live gap
// discovered on main: a version of this function shipped directly (bypassing
// the PR/test process used for every other fix today) that exempted ANY
// quote containing a citation-shaped substring from verbatim corpus
// verification — including fabricated factual claims merely phrased
// alongside a real (or even nonexistent) article number. Confirmed by direct
// reproduction before this fix (see conversation history): a completely
// invented claim about a hearing date, witness name, and testimony passed
// as "authority_exempt" purely because it also said "art. 16 constitucional".
//
// This tightens the predicate to only exempt quotes that are SUBSTANTIALLY
// JUST the citation, not a citation plus an independent factual assertion.
//
// All test quotes are generic/synthetic — no case-specific party names or
// fixture content, though several are modeled on the real failure pattern
// found in a live case (Peraza Manzanilla amparo) to make sure this fix
// covers the actual observed defect, not just a hypothetical one.
import { describe, it, expect } from "vitest";
import { isLegalAuthorityCitation } from "@/lib/intelligence/grounding.server";

describe("isLegalAuthorityCitation: pure citations are still exempted", () => {
  it("a bare constitutional article reference is exempt", () => {
    expect(isLegalAuthorityCitation("Artículo 16 de la Constitución Política de los Estados Unidos Mexicanos.")).toBe(true);
  });

  it("a bare tesis/jurisprudencia registry citation is exempt", () => {
    expect(isLegalAuthorityCitation("Tesis: 1a./J. 15/2019 (10a.)")).toBe(true);
  });

  it("a short 'se invoca la fracción X del art. Y de la Ley Z' citation is exempt", () => {
    expect(isLegalAuthorityCitation("Se invoca la fracción XX del art. 61 de la Ley de Amparo.")).toBe(true);
  });

  it("a CNPP article reference alone is exempt", () => {
    expect(isLegalAuthorityCitation("Arts. 263 y 264 del Código Nacional de Procedimientos Penales.")).toBe(true);
  });
});

describe("isLegalAuthorityCitation: the confirmed gap is closed — factual claims are NOT exempted just for mentioning an article", () => {
  it("a fabricated hearing/witness claim wrapped around a real article number is NOT exempt (the exact reproduced failure)", () => {
    const fabricated =
      "Conforme al art. 16 constitucional, la audiencia se celebró el 15 de marzo de 2026 con la presencia del testigo Juan Pérez, quien confirmó haber visto al acusado en el lugar de los hechos.";
    expect(isLegalAuthorityCitation(fabricated)).toBe(false);
  });

  it("a claim citing a fabricated/nonexistent article number is NOT exempt when it also asserts an independent fact", () => {
    const fabricated =
      "Conforme al art. 9999 del Código Federal, el testigo María López declaró haber recibido el pago el 3 de enero.";
    expect(isLegalAuthorityCitation(fabricated)).toBe(false);
  });

  it("a genuine factual/contradiction finding with no citation language at all is NOT exempt", () => {
    const factual =
      "Se advierte una contradicción documental relevante entre la bitácora BED-1120-2026 y el registro RCC-1120-2026 sobre el momento de generación de las imágenes forenses.";
    expect(isLegalAuthorityCitation(factual)).toBe(false);
  });

  it("a citation combined with a specific legal conclusion about THIS case is NOT exempt (must still verify against the actual document)", () => {
    // This mirrors the real borderline case from the Peraza Manzanilla
    // amparo: a citation plus a substantive legal conclusion, not a bare
    // citation. Correct behavior is to require real verbatim verification —
    // in the real case, this text does turn out to be genuinely verbatim in
    // its source document, so falling through to normal verification (not
    // blanket exemption) is the safe, correct outcome either way.
    const mixed =
      "Conforme al art. 20, apartado A, fracción IX, constitucional y a los arts. 263 y 264 del Código Nacional de Procedimientos Penales, la prueba obtenida con violación de derechos fundamentales es nula.";
    expect(isLegalAuthorityCitation(mixed)).toBe(false);
  });
});

describe("isLegalAuthorityCitation: edge cases", () => {
  it("returns false for null/undefined/empty input", () => {
    expect(isLegalAuthorityCitation(null)).toBe(false);
    expect(isLegalAuthorityCitation(undefined)).toBe(false);
    expect(isLegalAuthorityCitation("")).toBe(false);
  });

  it("returns false for text with no citation pattern at all, regardless of length", () => {
    expect(isLegalAuthorityCitation("El testigo declaró que vio al acusado en el lugar de los hechos.")).toBe(false);
  });
});
