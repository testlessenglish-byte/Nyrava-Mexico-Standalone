// Regression test for the amparo-vs-constitucional misclassification found on
// a real case (Amparo Indirecto 412/2026, an indigenous-consultation
// matter): the corpus discusses derechos humanos/CPEUM/SCJN jurisprudencia
// at length as the SUBSTANCE of the amparo claim, which previously outscored
// amparo's own procedural markers and classified the case as "constitucional"
// — the wrong materia, since "constitucional" specifically means a
// controversia constitucional / acción de inconstitucionalidad, a different
// and mutually-exclusive proceeding type from amparo.
import { describe, it, expect } from "vitest";
import { classifyMexicanCaseType, resolveMxCaseType } from "@/lib/mx-case-classifier";

describe("classifyMexicanCaseType: amparo vs constitucional", () => {
  it("classifies an amparo indirecto with heavy human-rights substance as amparo, not constitucional", () => {
    // Modeled on the real corpus's vocabulary density: repeated amparo
    // procedural terms alongside even more frequent derechos-humanos/CPEUM
    // discussion, with no controversia constitucional / acción de
    // inconstitucionalidad anywhere in the text.
    const text = `
      JUICIO DE AMPARO INDIRECTO 412/2026-VII
      Quejosa: Comunidad Indígena.
      Autoridad responsable: Secretaría de Medio Ambiente.
      Se concede la suspensión provisional del acto reclamado.
      El acto reclamado viola derechos humanos de la comunidad indígena.
      Conforme al control de convencionalidad y la jurisprudencia de la SCJN
      en materia de consulta previa, libre e informada, se han vulnerado
      derechos humanos reconocidos en la CPEUM y en tratados internacionales.
      La autoridad responsable no acreditó haber realizado consulta alguna,
      lo que constituye una violación grave a derechos humanos.
      Los quejosos solicitan amparo y protección de la justicia federal.
      Ley de Amparo, artículos aplicables al amparo indirecto.
    `.repeat(2);

    const result = classifyMexicanCaseType(text);
    expect(result.caseType).toBe("amparo");
  });

  it("still classifies a genuine controversia constitucional as constitucional", () => {
    const text = `
      CONTROVERSIA CONSTITUCIONAL promovida por el Municipio en contra del
      Poder Ejecutivo del Estado. Se plantea acción de inconstitucionalidad
      respecto del decreto impugnado. Conforme a la CPEUM y a la
      jurisprudencia de la SCJN sobre controversias constitucionales entre
      órdenes de gobierno.
    `.repeat(2);

    const result = classifyMexicanCaseType(text);
    expect(result.caseType).toBe("constitucional");
  });

  it("resolveMxCaseType: content-driven amparo classification wins over a blank declared area", () => {
    const text = `
      Juicio de amparo indirecto. Quejoso promueve contra acto reclamado de
      autoridad responsable. Suspensión definitiva concedida. Se invocan
      derechos humanos y control de convencionalidad como fundamento del
      concepto de violación. Ley de amparo aplicable. Amparo indirecto.
    `.repeat(2);

    const resolved = resolveMxCaseType({ text, declaredArea: null });
    expect(resolved.caseType).toBe("amparo");
  });
});
