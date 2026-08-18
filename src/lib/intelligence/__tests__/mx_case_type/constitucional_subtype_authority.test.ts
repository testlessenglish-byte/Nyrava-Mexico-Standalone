// Citation-scoping fix for the "constitucional" profile's shared checklist —
// companion to amparo_revision_profile_routing.test.ts (which fixed WHICH
// checklist an ADR case gets routed to) and constitucional_profile_routing
// .test.ts (the original 2239/2018 fix). This is the NEXT layer of the same
// bug class: even once an ADR case is correctly routed to the
// "constitucional" checklist, that checklist's items combine THREE
// proceedings' governing law (controversia constitucional / acción de
// inconstitucionalidad / amparo directo-o-indirecto en revisión) into one
// citation string — so an amparo en revisión case still showed "Ley
// Reglamentaria del Art. 105 CPEUM", a law that has nothing to do with an
// amparo en revisión.
//
// Real case: Amparo Directo en Revisión 5829/2025 (ISSSTE tax-exemption
// case) — the rendered PDF cited "Ley Reglamentaria del Art. 105 CPEUM Arts.
// 22 fr. III y 61 fr. III; Ley de Amparo Art. 88" for a missing "norma o
// acto impugnado" element, on a proceeding governed exclusively by the Ley
// de Amparo (Art. 88).
import { describe, it, expect } from "vitest";
import { resolveConstitucionalReviewSubtype } from "@/lib/execution/mx-pipeline";
import { evaluateProceduralCompliance } from "@/lib/intelligence/procedural-compliance";
import { resolveMissingDocuments } from "@/lib/intelligence/mx-missing-documents";
import { resolveProceduralStage } from "@/lib/intelligence/mx-procedural-stages";

const ADR_5829_CORPUS =
  "AMPARO DIRECTO EN REVISIÓN 5829/2025. El Instituto de Seguridad y Servicios " +
  "Sociales de los Trabajadores del Estado interpone recurso de revisión contra " +
  "la sentencia de amparo directo dictada por el Tribunal Colegiado en materia " +
  "de exención tributaria.";

const CONTROVERSIA_CORPUS =
  "CONTROVERSIA CONSTITUCIONAL 45/2026. El Municipio actor demanda al Poder " +
  "Ejecutivo del Estado por invasión de su esfera de competencia municipal.";

const ACCION_CORPUS =
  "ACCIÓN DE INCONSTITUCIONALIDAD 12/2026. La Comisión Nacional de los Derechos " +
  "Humanos impugna el decreto reformatorio publicado en el Diario Oficial de la Federación.";

describe("resolveConstitucionalReviewSubtype", () => {
  it("detects amparo en revisión from an ADR corpus", () => {
    expect(resolveConstitucionalReviewSubtype(ADR_5829_CORPUS)).toBe("amparo_en_revision");
  });

  it("detects controversia constitucional", () => {
    expect(resolveConstitucionalReviewSubtype(CONTROVERSIA_CORPUS)).toBe("controversia_constitucional");
  });

  it("detects acción de inconstitucionalidad", () => {
    expect(resolveConstitucionalReviewSubtype(ACCION_CORPUS)).toBe("accion_inconstitucionalidad");
  });

  it("returns null when the corpus gives no clear signal, never guesses", () => {
    expect(resolveConstitucionalReviewSubtype("El Pleno de la Suprema Corte resuelve.")).toBeNull();
    expect(resolveConstitucionalReviewSubtype("")).toBeNull();
  });
});

describe("evaluateProceduralCompliance — constitucional citation scoping", () => {
  it("the real reported bug: an ADR case never cites the unrelated Ley Reglamentaria del Art. 105", () => {
    const report = evaluateProceduralCompliance("constitucional", ADR_5829_CORPUS);
    const item = report.items.find((i) => i.id === "norma_o_acto_impugnado");
    expect(item?.authority).toBe("Ley de Amparo Art. 88");
    expect(item?.authority).not.toMatch(/Ley Reglamentaria del Art\. 105/);
  });

  it("also narrows plazo and conceptos-de-invalidez citations for the ADR subtype", () => {
    const report = evaluateProceduralCompliance("constitucional", ADR_5829_CORPUS);
    expect(report.items.find((i) => i.id === "plazo_impugnacion_constitucional")?.authority).toBe(
      "Ley de Amparo Art. 86",
    );
    expect(report.items.find((i) => i.id === "concepto_invalidez_o_agravios")?.authority).toBe(
      "Ley de Amparo Art. 88",
    );
    expect(report.items.find((i) => i.id === "legitimacion_constitucional")?.authority).toBe(
      "Ley de Amparo Art. 81 fr. II",
    );
  });

  it("a controversia constitucional case gets the Título II citation, not the combined string", () => {
    const report = evaluateProceduralCompliance("constitucional", CONTROVERSIA_CORPUS);
    expect(report.items.find((i) => i.id === "norma_o_acto_impugnado")?.authority).toBe(
      "Ley Reglamentaria del Art. 105 CPEUM Art. 22 fr. III",
    );
  });

  it("an acción de inconstitucionalidad case gets the Título III citation", () => {
    const report = evaluateProceduralCompliance("constitucional", ACCION_CORPUS);
    expect(report.items.find((i) => i.id === "norma_o_acto_impugnado")?.authority).toBe(
      "Ley Reglamentaria del Art. 105 CPEUM Art. 61 fr. III",
    );
  });

  it("keeps the original combined citation when the subtype can't be determined", () => {
    const report = evaluateProceduralCompliance("constitucional", "El Pleno resuelve el asunto planteado.");
    expect(report.items.find((i) => i.id === "norma_o_acto_impugnado")?.authority).toBe(
      "Ley Reglamentaria del Art. 105 CPEUM Arts. 22 fr. III y 61 fr. III; Ley de Amparo Art. 88",
    );
  });

  it("leaves every other materia's checklist untouched", () => {
    const report = evaluateProceduralCompliance("amparo", ADR_5829_CORPUS);
    expect(report.items.every((i) => !i.authority.includes("Ley Reglamentaria del Art. 105"))).toBe(true);
  });

  it("leaves items with no verified per-subtype alternative unchanged (suspension_constitucional)", () => {
    const report = evaluateProceduralCompliance("constitucional", ADR_5829_CORPUS);
    expect(report.items.find((i) => i.id === "suspension_constitucional")?.authority).toBe(
      "Ley Reglamentaria del Art. 105 CPEUM Arts. 14–18",
    );
  });
});

describe("resolveMissingDocuments — constitucional citation scoping", () => {
  it("narrows the required-document citation for an ADR case", () => {
    const report = resolveMissingDocuments("constitucional", ADR_5829_CORPUS);
    const doc = report.required.find((d) => d.id === "norma_o_acto_impugnado_doc");
    expect(doc?.authority).toBe("Ley de Amparo Art. 88");
  });

  it("narrows the standing-document citation too", () => {
    const report = resolveMissingDocuments("constitucional", ADR_5829_CORPUS);
    const doc = report.required.find((d) => d.id === "acreditacion_legitimacion_doc");
    expect(doc?.authority).toBe("Ley de Amparo Art. 81");
  });
});

describe("resolveProceduralStage — constitucional citation scoping", () => {
  it("narrows the stage-map citation for an ADR case", () => {
    const res = resolveProceduralStage("constitucional", ADR_5829_CORPUS);
    const stage = res.stages.find((s) => s.id === "norma_o_acto_impugnado");
    expect(stage?.authority).toBe("Ley de Amparo Art. 88");
  });

  it("narrows the admisión stage citation for an ADR case", () => {
    const res = resolveProceduralStage("constitucional", ADR_5829_CORPUS);
    const stage = res.stages.find((s) => s.id === "admision_constitucional");
    expect(stage?.authority).toBe("Ley de Amparo Art. 92");
  });

  it("leaves sentencia_constitucional's citation unchanged (no verified alternative)", () => {
    const res = resolveProceduralStage("constitucional", ADR_5829_CORPUS);
    const stage = res.stages.find((s) => s.id === "sentencia_constitucional");
    expect(stage?.authority).toBe("Ley Reglamentaria del Art. 105 Arts. 41-45 y 72-73");
  });
});
