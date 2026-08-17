import { describe, it, expect } from "vitest";
import { detectMatterSubtype, isEngineAllowedForSubtype, isTextAllowedForSubtype } from "../matter-subtype";

const FAMILY_AGENTS = [
  "agent:custody_best_interest_analysis",
  "agent:child_support_calculation",
  "agent:domestic_violence_assessment",
];

describe("matter subtype lock", () => {
  it("locks a juicio sucesorio testamentario out of the family-dispute agents", () => {
    const st = detectMatterSubtype(
      "familiar",
      "Sucesorio Testamentario 1543/2026 — nulidad de testamento público abierto; albacea designado",
    );
    expect(st?.key).toBe("sucesorio");
    for (const e of FAMILY_AGENTS) expect(isEngineAllowedForSubtype(st, e)).toBe(false);
    expect(isEngineAllowedForSubtype(st, "cross_examination")).toBe(true);
  });

  it("leaves a divorcio/custodia matter untouched", () => {
    const st = detectMatterSubtype("familiar", "Divorcio incausado con guarda y custodia y pensión alimenticia");
    expect(st).toBeNull();
    for (const e of FAMILY_AGENTS) expect(isEngineAllowedForSubtype(st, e)).toBe(true);
  });

  it("stands down when a succession case genuinely raises custody/alimentos", () => {
    const st = detectMatterSubtype(
      "familiar",
      "Juicio sucesorio intestamentario con menores herederos; se solicita pensión alimenticia y guarda y custodia",
    );
    expect(st).toBeNull();
  });

  it("never narrows materias without a rule", () => {
    for (const m of ["penal", "laboral", "amparo", "fiscal", "civil", "mercantil"]) {
      expect(detectMatterSubtype(m, "testamento sucesorio albacea")).toBeNull();
    }
  });
});

// Real-user bug report (2026-08-16/17): runStrategyEngine (litigation.server.ts)
// recommended "Solicitar la suspensión del acto reclamado" on an Amparo
// Directo en Revisión even though this exact subtype excludes
// agent:suspension_analysis — the strategy engine never consulted this lock
// at all, since the lock previously only gated the AGENTS-stage engine loop,
// never free-text LLM output from a separate engine.
describe("isTextAllowedForSubtype", () => {
  const adrSubtype = detectMatterSubtype(
    "amparo",
    "Amparo Directo en Revisión 4640/2017 — resolución de la Suprema Corte de Justicia de la Nación",
  );

  it("blocks a suspensión motion on an Amparo Directo en Revisión — the exact real-case reproduction", () => {
    expect(adrSubtype?.key).toBe("directo_en_revision");
    expect(
      isTextAllowedForSubtype(adrSubtype, "Solicitar la suspensión del acto reclamado ante el tribunal."),
    ).toBe(false);
  });

  it("blocks a standing/procedencia motion on the same subtype", () => {
    expect(
      isTextAllowedForSubtype(adrSubtype, "Argumentar falta de interés jurídico del quejoso."),
    ).toBe(false);
  });

  it("allows a motion about a topic the subtype does not exclude", () => {
    expect(
      isTextAllowedForSubtype(adrSubtype, "Preparar el alegato sobre control de convencionalidad."),
    ).toBe(true);
  });

  it("allows everything when there is no subtype at all", () => {
    expect(isTextAllowedForSubtype(null, "Solicitar la suspensión del acto reclamado.")).toBe(true);
  });

  it("blocks a family-dispute motion on a juicio sucesorio", () => {
    const sucesorio = detectMatterSubtype(
      "familiar",
      "Sucesorio Testamentario 1543/2026 — nulidad de testamento público abierto",
    );
    expect(
      isTextAllowedForSubtype(sucesorio, "Solicitar pensión alimenticia provisional para los herederos."),
    ).toBe(false);
  });
});
