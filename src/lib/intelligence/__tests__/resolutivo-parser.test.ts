// Regression tests for the structure-only resolutivo parser. Scope is
// deliberately narrow (agreed with the user after reviewing an external
// architecture proposal): extract WHAT the dispositive section says —
// type, raw text, ordinal, offset, extraction confidence — and never
// infer WHO it favors. beneficiary is always null and
// requiresLegalReview is always true; that inference is a real legal
// judgment call, not a mechanical extraction, and is deferred until it
// can be calibrated against a substantial set of real rulings.
//
// Two real bugs were caught by testing against realistic Mexican judgment
// text (not just synthetic examples) before this shipped:
//   1. JS's \b is ASCII-only even under the "u" flag, so \bÚNICO\b never
//      matched the accented "Ú" — a single-disposition ruling (the most
//      common shape for a short/ÚNICO amparo resolution) silently fell
//      through to the "no markers found" fallback. Fixed with explicit
//      \p{L}/\p{N} boundary lookarounds (same fix already applied
//      elsewhere in this codebase for the identical class of bug).
//   2. The standard SCJN/Tribunal Colegiado deny formula is "la Justicia
//      de la Unión no ampara ni protege" — not "no SE ampara", which
//      never appears in real rulings. The original pattern would have
//      silently mis-tagged every real amparo denial as "otro".
import { describe, it, expect } from "vitest";
import { parseResolutivos } from "../resolutivo-parser";

describe("parseResolutivos: structure only, never infers beneficiary", () => {
  it("splits a real multi-item RESUELVE block and classifies each by its standard dispositive verb", () => {
    const text = `
Algunos considerandos previos...

R E S U E L V E:

PRIMERO.- En la materia de la revisión competencia de esta Suprema Corte de Justicia de la Nación, se confirma la sentencia recurrida.

SEGUNDO.- La Justicia de la Unión no ampara ni protege a Fabiola Romo Hernández, en contra del acto reclamado consistente en el artículo 75 de la Ley de Amparo.

NOTIFÍQUESE; con testimonio de esta resolución...
`;
    const r = parseResolutivos(text);
    expect(r.found).toBe(true);
    expect(r.dispositions).toHaveLength(2);
    expect(r.dispositions[0]).toMatchObject({
      ordinal: "PRIMERO",
      type: "confirma",
      extractionConfidence: "high",
      beneficiary: null,
      requiresLegalReview: true,
    });
    expect(r.dispositions[1]).toMatchObject({
      ordinal: "SEGUNDO",
      type: "niega",
      extractionConfidence: "high",
      beneficiary: null,
      requiresLegalReview: true,
    });
  });

  it("handles a single-item ÚNICO ruling — the accented ordinal that previously broke on JS's ASCII-only \\b", () => {
    const text = `
RESUELVE:

ÚNICO.- Se declara infundado el recurso de revisión interpuesto por la parte quejosa.

Así lo resolvieron los ministros...
`;
    const r = parseResolutivos(text);
    expect(r.found).toBe(true);
    expect(r.dispositions).toHaveLength(1);
    expect(r.dispositions[0].ordinal).toBe("ÚNICO");
    expect(r.dispositions[0].type).toBe("niega");
    expect(r.dispositions[0].beneficiary).toBeNull();
  });

  it("classifies revocation and grant correctly, including 'para efectos'", () => {
    const text = `
SE RESUELVE:

PRIMERO. Se revoca la sentencia recurrida para efectos de que el Tribunal Colegiado emita una nueva resolución.

SEGUNDO. Se concede el amparo a la parte quejosa respecto del acto reclamado.

NOTIFÍQUESE.
`;
    const r = parseResolutivos(text);
    expect(r.dispositions.map((d) => d.type)).toEqual(["revoca", "concede"]);
    // Never infers who a "para efectos" revocation favors.
    expect(r.dispositions.every((d) => d.beneficiary === null)).toBe(true);
  });

  it("returns found:false — not a false 'zero holdings' claim — when no RESUELVE section exists at all (a fragment/excerpt corpus)", () => {
    const text =
      "Este es un fragmento publicado de la resolución que discute el artículo 75 de la Ley de Amparo sin incluir la sección resolutiva.";
    const r = parseResolutivos(text);
    expect(r.found).toBe(false);
    expect(r.dispositions).toEqual([]);
  });

  it("returns found:false for empty text", () => {
    expect(parseResolutivos("")).toEqual({ found: false, dispositions: [] });
  });

  it("never guesses a type for unrecognized dispositive text — 'otro' with low confidence instead", () => {
    const text = `
RESUELVE:

Se ordena notificar a las partes conforme a derecho.

NOTIFÍQUESE.
`;
    const r = parseResolutivos(text);
    expect(r.found).toBe(true);
    expect(r.dispositions).toHaveLength(1);
    expect(r.dispositions[0].type).toBe("otro");
    expect(r.dispositions[0].extractionConfidence).toBe("low");
  });

  it("never populates beneficiary or sets requiresLegalReview to false, for any disposition, ever", () => {
    const text = `
RESUELVE:

PRIMERO.- Se concede el amparo.
SEGUNDO.- Se niega la suspensión.
TERCERO.- Se revoca la resolución impugnada.

NOTIFÍQUESE.
`;
    const r = parseResolutivos(text);
    expect(r.dispositions.length).toBeGreaterThan(0);
    for (const d of r.dispositions) {
      expect(d.beneficiary).toBeNull();
      expect(d.requiresLegalReview).toBe(true);
    }
  });
});
