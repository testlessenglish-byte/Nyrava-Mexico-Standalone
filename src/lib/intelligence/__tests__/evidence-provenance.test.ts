// Tests for evidence-provenance.server.ts's pure utility functions — the
// character-offset location and cryptographic hashing layer added for the
// Phase 1 evidence-provenance work. No DB, no LLM — everything here is a
// deterministic pure function, so every case is exact-value asserted rather
// than "roughly correct".
import { describe, it, expect } from "vitest";
import {
  sha256Hex,
  lightNormalize,
  locateQuoteInText,
  pageForOffset,
  citationHash,
} from "@/lib/intelligence/evidence-provenance.server";

describe("sha256Hex", () => {
  it("is deterministic — same input always produces the same hash", () => {
    expect(sha256Hex("hola mundo")).toBe(sha256Hex("hola mundo"));
  });

  it("produces a 64-character lowercase hex digest", () => {
    const h = sha256Hex("cualquier texto");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different input", () => {
    expect(sha256Hex("texto A")).not.toBe(sha256Hex("texto B"));
  });

  it("is sensitive to a single character change", () => {
    expect(sha256Hex("Artículo 16")).not.toBe(sha256Hex("Artículo 17"));
  });
});

describe("lightNormalize", () => {
  it("lowercases without changing length", () => {
    const s = "El Acreedor Hipotecario";
    expect(lightNormalize(s).length).toBe(s.length);
  });

  it("folds accented Spanish characters to their base letter without changing length", () => {
    const s = "José Antonio Pérez Chan, según cláusula número 18,742";
    const out = lightNormalize(s);
    expect(out.length).toBe(s.length);
    expect(out).toBe("jose antonio perez chan, segun clausula numero 18,742");
  });

  it("handles ñ and ü correctly, preserving length", () => {
    expect(lightNormalize("año")).toBe("ano");
    expect(lightNormalize("bilingüe")).toBe("bilingue");
    expect(lightNormalize("bilingüe").length).toBe("bilingüe".length);
  });
});

describe("locateQuoteInText", () => {
  const rawText =
    "El inmueble ubicado en el número 42, propiedad del señor José Antonio " +
    "Pérez Chan, según escritura pública número 18,742, cuenta con una " +
    "cláusula de garantía hipotecaria a favor del acreedor.";

  it("finds an exact-accent quote at its true character offset", () => {
    const loc = locateQuoteInText("José Antonio Pérez Chan", rawText);
    expect(loc).not.toBeNull();
    expect(rawText.slice(loc!.start, loc!.end)).toBe("José Antonio Pérez Chan");
  });

  it("finds the same quote when the LLM dropped the accents (accent-insensitive), still returning TRUE raw offsets", () => {
    const loc = locateQuoteInText("Jose Antonio Perez Chan", rawText);
    expect(loc).not.toBeNull();
    // The located span in the RAW text still carries its original accents —
    // locate is accent-insensitive for matching, not for the returned span.
    expect(rawText.slice(loc!.start, loc!.end)).toBe("José Antonio Pérez Chan");
  });

  it("is case-insensitive", () => {
    const loc = locateQuoteInText("JOSÉ ANTONIO", rawText);
    expect(loc).not.toBeNull();
    expect(rawText.slice(loc!.start, loc!.end).toLowerCase()).toBe("josé antonio".toLowerCase());
  });

  it("locates a span at the very start of the text", () => {
    const loc = locateQuoteInText("El inmueble ubicado", rawText);
    expect(loc).toEqual({ start: 0, end: "El inmueble ubicado".length });
  });

  it("locates a span at the very end of the text", () => {
    const tail = "a favor del acreedor.";
    const loc = locateQuoteInText(tail, rawText);
    expect(loc).not.toBeNull();
    expect(loc!.end).toBe(rawText.length);
  });

  it("returns null for a quote that does not appear in the text at all", () => {
    expect(locateQuoteInText("María Fernanda Gómez Villareal", rawText)).toBeNull();
  });

  it("returns null for a quote shorter than the minimum length, regardless of match", () => {
    expect(locateQuoteInText("José", rawText)).toBeNull();
  });

  it("returns the FIRST occurrence when a phrase repeats", () => {
    const repeated = "acuerdo de pago. Segundo acuerdo de pago aquí.";
    const loc = locateQuoteInText("acuerdo de pago", repeated);
    expect(loc).toEqual({ start: 0, end: "acuerdo de pago".length });
  });

  it("returns null for empty raw text", () => {
    expect(locateQuoteInText("cualquier cosa larga", "")).toBeNull();
  });
});

describe("pageForOffset", () => {
  it("returns page 1 for offset 0", () => {
    expect(pageForOffset(0, 3000)).toBe(1);
  });

  it("returns page 1 for any offset within the first page", () => {
    expect(pageForOffset(2999, 3000)).toBe(1);
  });

  it("returns page 2 exactly at the page boundary", () => {
    expect(pageForOffset(3000, 3000)).toBe(2);
  });

  it("returns page 4 for an offset well into the fourth page", () => {
    expect(pageForOffset(9500, 3000)).toBe(4);
  });
});

describe("citationHash", () => {
  it("is deterministic for identical inputs", () => {
    const args = { documentId: "doc-1", quote: "cláusula de garantía", start: 10, end: 31 };
    expect(citationHash(args)).toBe(citationHash({ ...args }));
  });

  it("differs when the document changes but the quote/offsets don't", () => {
    const base = { quote: "cláusula de garantía", start: 10, end: 31 };
    expect(citationHash({ ...base, documentId: "doc-1" })).not.toBe(
      citationHash({ ...base, documentId: "doc-2" }),
    );
  });

  it("differs when the offsets change but the document/quote don't", () => {
    const base = { documentId: "doc-1", quote: "cláusula de garantía" };
    expect(citationHash({ ...base, start: 10, end: 31 })).not.toBe(
      citationHash({ ...base, start: 500, end: 521 }),
    );
  });

  it("is still well-defined (does not throw) when document/offsets are all null — the soft-match case", () => {
    expect(() => citationHash({ documentId: null, quote: "algo", start: null, end: null })).not.toThrow();
  });
});
