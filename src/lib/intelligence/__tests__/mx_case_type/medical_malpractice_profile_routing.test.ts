// Materia-routing addition for responsabilidad médica / mala praxis —
// report-quality audit §14: a medical-malpractice claim was previously
// evaluated against the generic "civil" checklist, which has no concept of
// informed consent, clinical-history completeness, standard-of-care
// (lex artis) expert evidence, or the causal link between the medical act
// and the injury — the exact elements the claim actually turns on.
import { describe, it, expect } from "vitest";
import { effectiveMxProfile, requireMxProfile } from "@/lib/execution/mx-pipeline";
import { evaluateProceduralCompliance } from "@/lib/intelligence/procedural-compliance";

describe("responsabilidad médica routes to its own checklist, not the base civil one", () => {
  it("a plain 'civil' case with no malpractice signal stays on the base civil profile", () => {
    expect(effectiveMxProfile("civil", "Juicio Ordinario Civil 45/2026")).toBe("civil");
    expect(effectiveMxProfile("civil")).toBe("civil");
  });

  it("routes to 'responsabilidad_medica' when the case name signals medical malpractice", () => {
    expect(effectiveMxProfile("civil", "Demanda por Negligencia Médica 12/2026")).toBe(
      "responsabilidad_medica",
    );
    expect(effectiveMxProfile("civil", "Responsabilidad Civil Médica 8/2026")).toBe(
      "responsabilidad_medica",
    );
  });

  it("routes from the DOCUMENT'S OWN text even when the case name says nothing", () => {
    const corpusHead =
      "El presente juicio deriva de la mala praxis en que incurrió el médico tratante durante " +
      "el procedimiento quirúrgico practicado a la parte actora.";
    expect(effectiveMxProfile("civil", "Caso García", corpusHead)).toBe("responsabilidad_medica");
  });

  it("does not false-positive on an ordinary civil corpus that never mentions medical negligence", () => {
    const corpus =
      "Juicio Ordinario Civil sobre cumplimiento de contrato de arrendamiento. La parte demandada " +
      "incumplió con el pago de rentas pactadas en el contrato base de la acción.";
    expect(requireMxProfile("civil")).toBe("civil");
    expect(effectiveMxProfile("civil", "Caso López", corpus)).toBe("civil");
  });

  it("is scoped to 'civil' only — an administrativo case (public institution liability) is untouched", () => {
    // A claim against IMSS/ISSSTE/a public hospital is correctly a
    // state-liability matter under administrativo law, a different
    // framework this override deliberately does not attempt to model.
    expect(
      effectiveMxProfile("administrativo", "Reclamación por negligencia médica en hospital del IMSS"),
    ).toBe("administrativo");
  });

  it("the real gap this closes: requires informed consent, clinical file, and causal-link evidence a generic civil checklist never asks for", () => {
    const profile = effectiveMxProfile("civil", "Demanda por Negligencia Médica 12/2026");
    expect(profile).toBe("responsabilidad_medica");
    const corpus =
      "Demanda por negligencia médica. La parte actora suscribió consentimiento informado previo a la " +
      "cirugia. El expediente clinico documenta la nota de evolucion. El dictamen pericial medico " +
      "concluye que existe nexo causal entre la conducta medica y el dano.";
    const report = evaluateProceduralCompliance(profile, corpus);

    const requiredIds = report.items.filter((i) => i.requirement === "required").map((i) => i.id);
    expect(requiredIds).toContain("consentimiento_informado_resp_medica");
    expect(requiredIds).toContain("expediente_clinico_completo");
    expect(requiredIds).toContain("nexo_causal");
    expect(requiredIds).toContain("dictamen_pericial_medico_resp");

    // None of these elements exist on the base civil checklist at all.
    expect(report.items.find((i) => i.id === "consentimiento_informado_resp_medica")).toBeDefined();
  });
});
