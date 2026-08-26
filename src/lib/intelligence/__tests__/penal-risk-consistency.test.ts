import { describe, expect, it } from "vitest";
import {
  deterministicRiskBand,
  enforceRiskNarrative,
  riskNarrativeContradictsScore,
} from "@/lib/score-bands";

describe("deterministic Penal risk language", () => {
  it("maps score 6 to bajo", () => {
    expect(deterministicRiskBand(6)).toMatchObject({ id: "low", label_es: "bajo" });
  });

  it("rewrites contradictory high-risk prose for a low score", () => {
    const result = enforceRiskNarrative(6, "Existe un riesgo significativo y considerable.", "es");
    expect(result.rewritten).toBe(true);
    expect(result.text).toBe("Riesgo global: bajo (6/100).");
    expect(result.text).not.toMatch(/significativo|considerable/i);
  });

  it("keeps consistent explanatory prose under the deterministic heading", () => {
    const result = enforceRiskNarrative(72, "El riesgo es alto por las causas verificadas.", "es");
    expect(result.rewritten).toBe(false);
    expect(result.text).toContain("Riesgo global: alto (72/100).");
  });

  it("does not split a compound low-moderate label into conflicting bands", () => {
    expect(riskNarrativeContradictsScore(25, "Riesgo bajo-moderado.")).toBe(false);
  });

  it("uses all five required bands", () => {
    expect([0, 20, 40, 60, 80].map((score) => deterministicRiskBand(score).id)).toEqual([
      "low",
      "low_moderate",
      "moderate",
      "high",
      "critical",
    ]);
    expect(riskNarrativeContradictsScore(6, "riesgo alto")).toBe(true);
  });
});
