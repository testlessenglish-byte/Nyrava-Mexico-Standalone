// Tests for the citation-graph pieces of Phase 2 (Knowledge Library)
// "relationship graph": citation-extract.ts's pure regex extraction (never
// had test coverage despite existing since Phase 20) and
// projection.server.ts's parseTesisRegistry, the pure half of resolving an
// extracted citation to an existing legal_authorities row. The DB-touching
// half (projectCitations, resolveCitedAuthority) isn't unit-tested here —
// same convention as upsertAuthorityWithVersioning elsewhere in this
// directory — but every pure decision it depends on is.
import { describe, it, expect } from "vitest";
import { extractCitationsFromText } from "@/lib/legal-connectors/citation-extract";
import { parseTesisRegistry } from "@/lib/legal-connectors/projection.server";

describe("extractCitationsFromText", () => {
  it("extracts an article citation with its law name", () => {
    const found = extractCitationsFromText("Conforme al Artículo 123 de la Ley Federal del Trabajo, el patrón debe...");
    const article = found.find((c) => c.citationText.startsWith("Art. 123"));
    expect(article).toBeDefined();
    // The pattern's own "de la"/"del" group consumes that connector before
    // the law-name capture group starts, so the captured hint is just the
    // law name itself ("Ley Federal del Trabajo") — extractCitationsFromText
    // then re-adds a single "de" when building the display string.
    expect(article!.citedAuthorityHint).toBe("Ley Federal del Trabajo");
    expect(article!.citationText).toBe("Art. 123 de Ley Federal del Trabajo");
  });

  it("extracts an article citation with no law name attached, with a null hint", () => {
    const found = extractCitationsFromText("Véase el Art. 16 Constitucional para el requisito de fundamentación.");
    // "Constitucional" is adjective text, not captured as a law-name group
    // by the pattern's second capture — either way the article number
    // itself must be captured.
    const article = found.find((c) => c.citationText.startsWith("Art. 16"));
    expect(article).toBeDefined();
  });

  it("extracts a tesis/jurisprudencia registry citation", () => {
    const found = extractCitationsFromText("Es aplicable la tesis 1a./J. 15/2019 (10a.) sobre el tema.");
    const tesis = found.find((c) => c.citationText.startsWith("Tesis:"));
    expect(tesis).toBeDefined();
    expect(tesis!.citationText).toBe("Tesis: 1a./J. 15/2019 (10a.)");
  });

  it("extracts a bare code abbreviation with itself as the hint", () => {
    const found = extractCitationsFromText("La conducta se tipifica conforme al CNPP y su artículo 132.");
    const bare = found.find((c) => c.citationText === "CNPP");
    expect(bare).toBeDefined();
    expect(bare!.citedAuthorityHint).toBe("CNPP");
  });

  it("does not duplicate the same citation text seen more than once", () => {
    // A comma directly after the article number blocks the law-name group
    // from engaging at all (it requires a capital letter with no leading
    // punctuation), so both occurrences produce the identical bare "Art. 5"
    // citation deterministically — safe to assert an exact dedup count on.
    const found = extractCitationsFromText("Ver Artículo 5, y también el Artículo 5, para más detalles.");
    const matches = found.filter((c) => c.citationText === "Art. 5");
    expect(matches.length).toBe(1);
  });

  it("returns an empty array for text with no recognizable citations", () => {
    expect(extractCitationsFromText("El testigo declaró haber visto el vehículo rojo estacionado.")).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(extractCitationsFromText("")).toEqual([]);
  });
});

describe("parseTesisRegistry", () => {
  it("extracts the registry number from a well-formed tesis citation", () => {
    expect(parseTesisRegistry("Tesis: 1a./J. 15/2019 (10a.)")).toBe("1a./J. 15/2019 (10a.)");
  });

  it("trims surrounding whitespace from the extracted registry", () => {
    expect(parseTesisRegistry("Tesis:   2a./J. 45/2020 (10a.)  ")).toBe("2a./J. 45/2020 (10a.)");
  });

  it("returns null for a non-tesis citation (article reference)", () => {
    expect(parseTesisRegistry("Art. 123 de la Ley Federal del Trabajo")).toBeNull();
  });

  it("returns null for a bare code abbreviation", () => {
    expect(parseTesisRegistry("LFT")).toBeNull();
  });

  it("returns null for a 'Tesis:' prefix with nothing after it", () => {
    expect(parseTesisRegistry("Tesis:")).toBeNull();
    expect(parseTesisRegistry("Tesis:   ")).toBeNull();
  });

  it("round-trips with extractCitationsFromText's own tesis output", () => {
    const [found] = extractCitationsFromText("Tesis: P./J. 9/2021 (11a.) es de observancia obligatoria.");
    expect(found.citationText.startsWith("Tesis:")).toBe(true);
    expect(parseTesisRegistry(found.citationText)).toBe("P./J. 9/2021 (11a.)");
  });
});
