// Regression test for a real cross-materia contamination bug (ADR
// 4640/2017, Fabiola Romo Hernández — a CIVIL apelación reviewed via
// amparo directo en revisión): agent:ways_out_analysis wrote "La
// resolución del Tribunal de Enjuiciamiento desestimó un argumento
// novedoso sobre el debido proceso..." — "Tribunal de Enjuiciamiento" is
// the oral-trial tribunal in Mexico's accusatorial CRIMINAL procedure
// (CNPP). It does not exist in a civil dispute, and none of the finding's
// own cited quotes even mentioned it — the agent supplied the term itself.
import { describe, it, expect } from "vitest";
import { checkDomainVocabulary, checkFindingDomainVocabulary } from "../domain-vocabulary-gate";

const realBadFinding = {
  title: "Inoperancia de agravios no planteados en la demanda",
  description:
    "La resolución del Tribunal de Enjuiciamiento desestimó un argumento novedoso sobre el debido proceso, alegando que no fue planteado en la demanda de amparo.",
};

describe("checkFindingDomainVocabulary", () => {
  it("flags the real bug: Tribunal de Enjuiciamiento in an amparo (civil) case", () => {
    const r = checkFindingDomainVocabulary(realBadFinding, "amparo");
    expect(r.clean).toBe(false);
    expect(r.violations).toContain("Tribunal de Enjuiciamiento");
  });

  it("does NOT flag the same term for a genuine penal case — it's a real institution there", () => {
    const r = checkFindingDomainVocabulary(realBadFinding, "penal");
    expect(r.clean).toBe(true);
  });

  it("never flags anything when materia is unknown/unset — this gate only fires when we positively know the case is not penal", () => {
    const r = checkFindingDomainVocabulary(realBadFinding, undefined);
    expect(r.clean).toBe(true);
  });

  it("leaves a genuinely clean amparo finding untouched", () => {
    const r = checkFindingDomainVocabulary(
      {
        title: "No vulneración del derecho a la seguridad jurídica",
        description:
          "La resolución establece que la certeza de que la autoridad judicial analiza los argumentos no depende de la transcripción de los agravios, sino de que se respondan adecuadamente.",
      },
      "amparo",
    );
    expect(r.clean).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("also catches Ministerio Público appearing in a civil finding's prose (complements the affected_party fix, which only covers the structured field)", () => {
    const r = checkDomainVocabulary(
      "El Ministerio Público no participó en este procedimiento civil.",
      "civil",
    );
    expect(r.clean).toBe(false);
    expect(r.violations).toContain("Ministerio Público");
  });
});
