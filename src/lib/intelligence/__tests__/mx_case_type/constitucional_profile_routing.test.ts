// Materia-routing fix for "constitucional" — controversia constitucional /
// acción de inconstitucionalidad / amparo directo o indirecto EN REVISIÓN
// (SCJN judicial review), previously routed unconditionally through the
// "derechos_humanos" profile (a CNDH administrative-complaint checklist).
//
// Confirmed on a real case: Amparo Directo en Revisión 2239/2018 (Martha
// Cristina Peña Esquivel) got a false, scored-negative procedural finding —
// "Queja presentada ante la comisión competente" (Ley de la CNDH Art. 25–27)
// — asserted as a REQUIRED element of a judicial SCJN proceeding that was
// never a CNDH complaint and never could be one. PROFILE_BY_MATERIA.
// constitucional now defaults to its own "constitucional" profile (judicial
// review) instead of "derechos_humanos" (CNDH complaint); "derechos_humanos"
// remains reachable via effectiveMxProfile for an actual CNDH/human-rights-
// commission complaint, using the same case-name text-narrowing pattern
// already proven for "apelacion" (apelacion_pipeline_stages.test.ts).
import { describe, it, expect } from "vitest";
import {
  effectiveMxProfile,
  requireMxProfile,
  isStageRelevantForCaseType,
  mxPartyRoleEnum,
} from "@/lib/execution/mx-pipeline";
import { evaluateProceduralCompliance } from "@/lib/intelligence/procedural-compliance";

describe("constitucional materia defaults to SCJN judicial review, not a CNDH complaint", () => {
  it("resolves to its own 'constitucional' profile by default — no case name needed", () => {
    expect(requireMxProfile("constitucional")).toBe("constitucional");
    expect(effectiveMxProfile("constitucional")).toBe("constitucional");
    expect(effectiveMxProfile("constitucional", "Amparo Directo en Revisión 2239/2018")).toBe(
      "constitucional",
    );
  });

  it("excludes the witness stage — resolved on the written record, same as amparo", () => {
    expect(
      isStageRelevantForCaseType(
        "constitucional",
        "witness",
        "Amparo Directo en Revisión 2239/2018",
      ),
    ).toBe(false);
  });

  it("has its own party-role enum distinct from derechos_humanos' quejoso/autoridad_responsable pair", () => {
    expect(mxPartyRoleEnum("constitucional")).toBe(
      '"promovente"|"autoridad_responsable"|"tercero_interesado"|"ambas"',
    );
  });

  it("routes back to derechos_humanos only when the case name signals an actual CNDH/human-rights-commission complaint", () => {
    expect(
      effectiveMxProfile(
        "constitucional",
        "Queja ante la Comisión Nacional de los Derechos Humanos 1/2026",
      ),
    ).toBe("derechos_humanos");
    expect(effectiveMxProfile("constitucional", "Recomendación CNDH 45/2026")).toBe(
      "derechos_humanos",
    );
  });

  it("does NOT false-positive into derechos_humanos on a judicial case that merely discusses human-rights doctrine at length", () => {
    // Same failure class as the amparo/412-2026 misclassification this
    // session already fixed in mx-case-classifier.ts: discussing "derechos
    // humanos" as SUBSTANCE must never be mistaken for filing a CNDH
    // complaint as VEHICLE.
    expect(effectiveMxProfile("constitucional", "Amparo Directo en Revisión 2239/2018")).not.toBe(
      "derechos_humanos",
    );
  });

  it("the real reported bug: no longer asserts a CNDH queja as a required, missing procedural element on a judicial constitutional-review corpus", () => {
    const profile = effectiveMxProfile("constitucional", "Amparo Directo en Revisión 2239/2018");
    const corpus =
      "Amparo Directo en Revisión 2239/2018. La Primera Sala de la Suprema Corte de Justicia de la " +
      "Nación resuelve el recurso de revisión interpuesto contra la sentencia dictada por el Tribunal " +
      "Colegiado. La recurrente cuenta con legitimacion activa acreditada conforme al artículo 81 de " +
      "la Ley de Amparo. Se hicieron valer agravios en tiempo y forma, dentro del plazo legal aplicable.";
    const report = evaluateProceduralCompliance(profile, corpus);

    const cndhItem = report.items.find((i) => i.id === "queja");
    expect(cndhItem).toBeUndefined();

    const cndhFinding = report.items.find((i) => /comisión|cndh/i.test(i.label_es));
    expect(cndhFinding).toBeUndefined();
  });

  it("a genuine CNDH complaint corpus still gets evaluated against the queja checklist when the case name signals it", () => {
    const profile = effectiveMxProfile(
      "constitucional",
      "Queja ante la Comisión Nacional de los Derechos Humanos 1/2026",
    );
    expect(profile).toBe("derechos_humanos");
    const report = evaluateProceduralCompliance(
      profile,
      "queja ante la comision nacional de derechos humanos",
    );
    expect(report.items.some((i) => i.id === "queja" && i.status === "cumplido")).toBe(true);
  });
});
