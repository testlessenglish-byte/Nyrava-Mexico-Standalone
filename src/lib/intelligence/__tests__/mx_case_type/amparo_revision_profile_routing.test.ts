// Materia-routing fix for "amparo" cases that are actually an amparo
// DIRECTO EN REVISIÓN before the SCJN — companion to
// constitucional_profile_routing.test.ts's ADR 2239/2018 fix.
//
// Real case: a 1-document corpus consisting of "AMPARO DIRECTO EN REVISIÓN
// 4640/2017" (an SCJN constitutional-analysis resolution, not a full
// first-instance amparo expediente) was filed under case_type="amparo" —
// exactly what the platform's own UI label tells an attorney to pick
// ("Juicio de Amparo ... incluye amparo directo en revisión ante la SCJN").
// The base "amparo" procedural checklist (acto reclamado, suspensión,
// informe justificado, principio de definitividad) and the standing/
// suspensión/authority-notification investigator agents all examine facts
// of the ORIGINAL amparo trial that an SCJN review opinion has no reason to
// restate — producing a misleadingly low procedural-compliance coverage
// number and irrelevant agent findings. This exercises both halves of the
// fix: effectiveMxProfile's text-signal override (checklist selection) and
// matter-subtype.ts's excludedEngines (agent-stage exclusion).
import { describe, it, expect } from "vitest";
import { effectiveMxProfile, requireMxProfile } from "@/lib/execution/mx-pipeline";
import { evaluateProceduralCompliance } from "@/lib/intelligence/procedural-compliance";
import { detectMatterSubtype, isEngineAllowedForSubtype } from "@/lib/jurisdiction/matter-subtype";

describe("amparo directo en revisión routes to the 'constitucional' checklist, not the base amparo one", () => {
  it("a plain 'amparo' case with no ADR signal stays on the base amparo profile", () => {
    expect(effectiveMxProfile("amparo", "Amparo Indirecto 123/2026")).toBe("amparo");
    expect(effectiveMxProfile("amparo")).toBe("amparo");
  });

  it("routes to 'constitucional' when the CASE NAME signals amparo directo en revisión", () => {
    expect(effectiveMxProfile("amparo", "Amparo Directo en Revisión 4640/2017")).toBe(
      "constitucional",
    );
    expect(effectiveMxProfile("amparo", "ADR 4640/2017")).toBe("constitucional");
  });

  it("routes to 'constitucional' from the DOCUMENT'S OWN text even when the case name says nothing — the real reported scenario", () => {
    // The case was simply named "Caso Peña" with no ADR wording; only the
    // uploaded document's own header announces what it is. This is the exact
    // gap the base name-only signal (used by apelación/CNDH already) missed.
    const corpusHead =
      "AMPARO DIRECTO EN REVISIÓN 4640/2017. Quejosa: Fabiola Romo Hernández. " +
      "La Primera Sala de la Suprema Corte de Justicia de la Nación resuelve.";
    expect(effectiveMxProfile("amparo", "Caso Peña", corpusHead)).toBe("constitucional");
  });

  it("does not false-positive on an ordinary amparo indirecto corpus that never mentions revisión ante la SCJN", () => {
    const corpus =
      "Juicio de Amparo Indirecto 55/2026. El quejoso señala como acto reclamado la orden de " +
      "cateo dictada por el Juez de Distrito. Se solicita la suspensión provisional del acto.";
    expect(requireMxProfile("amparo")).toBe("amparo");
    expect(effectiveMxProfile("amparo", "Amparo Indirecto 55/2026", corpus)).toBe("amparo");
  });

  it("the real reported bug: does not require acto reclamado / informe justificado / interés jurídico on an ADR corpus", () => {
    const profile = effectiveMxProfile("amparo", "Amparo Directo en Revisión 4640/2017");
    expect(profile).toBe("constitucional");
    const corpus =
      "AMPARO DIRECTO EN REVISIÓN 4640/2017. La Primera Sala de la Suprema Corte de Justicia de la " +
      "Nación resuelve el recurso de revisión interpuesto contra la sentencia dictada por el Tribunal " +
      "Colegiado. La recurrente cuenta con legitimacion activa acreditada. Se hicieron valer agravios " +
      "en tiempo y forma, dentro del plazo legal aplicable.";
    const report = evaluateProceduralCompliance(profile, corpus);

    expect(report.items.find((i) => i.id === "acto_reclamado")).toBeUndefined();
    expect(report.items.find((i) => i.id === "informe_justificado")).toBeUndefined();
    expect(report.items.find((i) => i.id === "interes_juridico")).toBeUndefined();
    expect(report.items.find((i) => i.id === "principio_definitividad")).toBeUndefined();
    // "cuestion_constitucionalidad" is recommended, not required, on this
    // profile specifically to avoid the same class of false "faltante".
    const constEl = report.items.find((i) => i.id === "cuestion_constitucionalidad");
    expect(constEl?.requirement).toBe("recommended");
  });
});

describe("amparo directo en revisión subtype excludes first-instance-trial-only investigator agents", () => {
  const adrCorpus =
    "AMPARO DIRECTO EN REVISIÓN 4640/2017. La Primera Sala de la Suprema Corte de Justicia de la " +
    "Nación resuelve el recurso de revisión interpuesto contra la sentencia dictada por el Tribunal Colegiado.";

  it("detects the subtype from the corpus alone", () => {
    const subtype = detectMatterSubtype("amparo", adrCorpus);
    expect(subtype?.key).toBe("directo_en_revision");
  });

  it("excludes standing_procedencia, suspension_analysis, and authority_notification_validation", () => {
    const subtype = detectMatterSubtype("amparo", adrCorpus);
    expect(isEngineAllowedForSubtype(subtype, "agent:standing_procedencia")).toBe(false);
    expect(isEngineAllowedForSubtype(subtype, "agent:suspension_analysis")).toBe(false);
    expect(isEngineAllowedForSubtype(subtype, "agent:authority_notification_validation")).toBe(false);
  });

  it("does NOT exclude the constitutional-analysis agents an SCJN review opinion actually needs", () => {
    const subtype = detectMatterSubtype("amparo", adrCorpus);
    expect(isEngineAllowedForSubtype(subtype, "agent:conventionality_pro_persona")).toBe(true);
    expect(isEngineAllowedForSubtype(subtype, "agent:constitutional_rights_mapping")).toBe(true);
    expect(isEngineAllowedForSubtype(subtype, "agent:international_human_rights_analysis")).toBe(true);
    expect(isEngineAllowedForSubtype(subtype, "agent:constitutional_controversy_analysis")).toBe(true);
  });

  it("a plain amparo indirecto corpus triggers no subtype lock at all", () => {
    const corpus =
      "Juicio de Amparo Indirecto 55/2026. El quejoso señala como acto reclamado la orden de cateo.";
    const subtype = detectMatterSubtype("amparo", corpus);
    expect(subtype).toBeNull();
    expect(isEngineAllowedForSubtype(subtype, "agent:standing_procedencia")).toBe(true);
    expect(isEngineAllowedForSubtype(subtype, "agent:suspension_analysis")).toBe(true);
  });
});
