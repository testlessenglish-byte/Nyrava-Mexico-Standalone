import { describe, it, expect } from "vitest";
import { detectMatterSubtype, isEngineAllowedForSubtype } from "../matter-subtype";

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
