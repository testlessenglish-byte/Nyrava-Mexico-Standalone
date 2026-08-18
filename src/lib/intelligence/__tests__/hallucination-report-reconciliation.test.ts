import { describe, expect, it } from "vitest";
import {
  __test__filterConcludedCaseRecommendations as filterConcludedCaseRecommendations,
  __test__reconcileStrengthScoreText as reconcileStrengthScoreText,
  __test__scrubQuarantinedActionSentence as scrubQuarantinedActionSentence,
  __test__scrubScorePlaceholderSentence as scrubScorePlaceholderSentence,
} from "../hallucination.server";

describe("post-report reconciliation", () => {
  it("removes an unsupported quarantined action from narrative prose", () => {
    const text =
      "La Corte declaró inoperante el agravio. Se recomienda presentar una nueva demanda de amparo que aborde los argumentos no considerados. La resolución debe revisarse con el expediente.";
    const result = scrubQuarantinedActionSentence(text, [
      "Presentar una nueva demanda de amparo que aborde los argumentos no considerados.",
    ]);
    expect(result).toContain("La Corte declaró inoperante el agravio.");
    expect(result).not.toContain("nueva demanda de amparo");
    expect(result).toContain("La resolución debe revisarse con el expediente.");
  });

  it("removes a close paraphrase of the same quarantined action", () => {
    const text =
      "Se sugiere que el quejoso considere presentar un nuevo amparo para abordar los argumentos no considerados.";
    const result = scrubQuarantinedActionSentence(text, [
      "Presentar una nueva demanda de amparo que aborde los argumentos no considerados.",
    ]);
    expect(result).toBe("");
  });

  it("does not remove unrelated attorney guidance", () => {
    const text = "Verificar el engrose y confirmar los puntos resolutivos antes de citar la sentencia.";
    const result = scrubQuarantinedActionSentence(text, [
      "Presentar una nueva demanda de amparo que aborde los argumentos no considerados.",
    ]);
    expect(result).toBe(text);
  });

  it("reconciles the score prose to the persisted deterministic score", () => {
    expect(
      reconcileStrengthScoreText(
        "La fortaleza del caso se califica en 64, lo que indica un nivel medio.",
        64,
        65,
      ),
    ).toBe("La fortaleza del caso se califica en 65, lo que indica un nivel medio.");
  });

  it("leaves score prose unchanged when raw and final scores agree", () => {
    const text = "La fortaleza del caso se califica en 65.";
    expect(reconcileStrengthScoreText(text, 65, 65)).toBe(text);
  });

  it("drops only the broken internal score-placeholder sentence", () => {
    const result = scrubScorePlaceholderSentence(
      "La puntuación general del caso es 67. La confianza general del análisis es del well-supported, lo que refleja certeza alta.",
    );
    expect(result.text).toBe("La puntuación general del caso es 67.");
    expect(result.removed).toBe(1);
  });

  it("removes an unsupported new-proceeding recommendation from a concluded audit", () => {
    const result = filterConcludedCaseRecommendations(
      [
        {
          title: "Demanda de amparo indirecto",
          supportingFindingIds: [],
          supportingEvidence: [],
        },
        {
          title: "Verificar el engrose y los puntos resolutivos",
          supportingFindingIds: [],
          supportingEvidence: [],
        },
      ],
      "concluded_audit",
    );
    expect(result.removed).toBe(1);
    expect(result.recommendations).toHaveLength(1);
  });

  it("keeps a new-proceeding recommendation when a concluded audit carries structured support", () => {
    const recommendations = [
      {
        title: "Interponer recurso de revisión",
        supportingFindingIds: ["finding-1"],
        supportingEvidence: [],
      },
    ];
    const result = filterConcludedCaseRecommendations(recommendations, "concluded_audit");
    expect(result.removed).toBe(0);
    expect(result.recommendations).toEqual(recommendations);
  });

  it("does not apply concluded-audit suppression to an ongoing matter", () => {
    const recommendations = [
      {
        title: "Demanda de amparo indirecto",
        supportingFindingIds: [],
        supportingEvidence: [],
      },
    ];
    const result = filterConcludedCaseRecommendations(recommendations, "ongoing");
    expect(result.removed).toBe(0);
    expect(result.recommendations).toEqual(recommendations);
  });
});