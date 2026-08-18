import { describe, expect, it } from "vitest";
import {
  __test__reconcileStrengthScoreText as reconcileStrengthScoreText,
  __test__scrubQuarantinedActionSentence as scrubQuarantinedActionSentence,
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
});
