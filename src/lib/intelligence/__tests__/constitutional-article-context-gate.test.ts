// Real case: Amparo Directo en Revisión 5829/2025 (ISSSTE tax-exemption
// dispute) cited "Art. 115, fracción IV" CPEUM — the municipal-treasury
// provision, exclusive to municipios — on a federal-parastatal-entity tax
// case whose corpus never mentions a municipio. See
// constitutional-article-context-gate.ts's module header for the full
// rationale.
import { describe, it, expect } from "vitest";
import { checkConstitutionalArticleContext } from "../constitutional-article-context-gate";

describe("checkConstitutionalArticleContext", () => {
  it("the real reported bug: flags Art. 115 cited on a corpus with no municipio/ayuntamiento mention", () => {
    const corpus =
      "El ISSSTE impugna la obligación de pagar impuesto predial y sobre nóminas, argumentando " +
      "que la exención fiscal del artículo 230 de la LISSSTE debería aplicarse.";
    const check = checkConstitutionalArticleContext("Art. 115, fracción IV", corpus);
    expect(check.outOfContext).toBe(true);
    expect(check.label).toMatch(/Art\. 115/);
  });

  it("does not flag Art. 115 when the corpus genuinely discusses a municipio", () => {
    const corpus =
      "El municipio de Guadalajara impugna la resolución del ayuntamiento vecino sobre límites " +
      "territoriales y hacienda municipal, con fundamento en el artículo 115 fracción IV.";
    const check = checkConstitutionalArticleContext("Art. 115, fracción IV", corpus);
    expect(check.outOfContext).toBe(false);
  });

  it("does not flag any other article — narrow, evidenced denylist only", () => {
    const corpus = "Caso sin mención alguna de municipios.";
    expect(checkConstitutionalArticleContext("Art. 122, Apartado A, fracción V", corpus).outOfContext).toBe(
      false,
    );
    expect(checkConstitutionalArticleContext("Art. 16 CPEUM", corpus).outOfContext).toBe(false);
  });

  it("returns clean for a null/empty citation", () => {
    expect(checkConstitutionalArticleContext(null, "cualquier texto").outOfContext).toBe(false);
    expect(checkConstitutionalArticleContext("", "cualquier texto").outOfContext).toBe(false);
    expect(checkConstitutionalArticleContext(undefined, "").outOfContext).toBe(false);
  });

  it("matches accent-insensitive corpus mentions of municipio/ayuntamiento", () => {
    const corpus = "El régimen de los MUNICIPIOS conforme al Ayuntamiento correspondiente.";
    expect(checkConstitutionalArticleContext("artículo 115", corpus).outOfContext).toBe(false);
  });
});
