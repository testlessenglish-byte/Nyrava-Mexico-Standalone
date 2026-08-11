// Regression test for a real deterministic extraction failure (ADR
// 4640/2017, Fabiola Romo Hernández — Amparo Directo en Revisión): every
// generated finding said "El quejoso alega..." even though the case's own
// party is a woman and the source caption reads "QUEJOSA Y RECURRENTE:
// FABIOLA ROMO HERNÁNDEZ". This is not a model-ambiguity problem — the
// corpus states the correct grammatical role gender explicitly — so the fix
// is a deterministic remediation pass (legal-qa.server.ts's existing
// REMEDIATE stage, mx-terminology.ts), not a prompt tweak. A party's gender
// is never inferred from their NAME (see this session's own pronoun-
// inference rule) — only ever read from the literal role marker the source
// document itself uses.
import { describe, it, expect } from "vitest";
import { detectPartyGenderFromCorpus, remediatePartyGender } from "../mx-terminology";

describe("detectPartyGenderFromCorpus", () => {
  it("detects the real case's feminine role marker from its caption", () => {
    const corpus =
      "AMPARO DIRECTO EN REVISIÓN 4640/2017. QUEJOSA Y RECURRENTE: FABIOLA ROMO HERNÁNDEZ.";
    expect(detectPartyGenderFromCorpus(corpus)).toEqual({ quejoso: "f" });
  });

  it("detects a masculine marker the same way", () => {
    expect(detectPartyGenderFromCorpus("QUEJOSO: JUAN PÉREZ LÓPEZ.")).toEqual({ quejoso: "m" });
  });

  it("stays silent (no correction) when the corpus contains BOTH forms — ambiguous, no safe correction", () => {
    const corpus = "QUEJOSA: FABIOLA ROMO. El quejoso original presentó el escrito inicial.";
    expect(detectPartyGenderFromCorpus(corpus).quejoso).toBeUndefined();
  });

  it("stays silent when the role never appears at all", () => {
    expect(detectPartyGenderFromCorpus("Texto sin mención de partes.")).toEqual({});
  });
});

describe("remediatePartyGender", () => {
  it("fixes the real bug: 'El quejoso alega...' becomes 'La quejosa alega...' for a feminine case", () => {
    const r = remediatePartyGender("El quejoso alega que se viola su derecho al debido proceso.", {
      quejoso: "f",
    });
    expect(r.text).toBe("La quejosa alega que se viola su derecho al debido proceso.");
    expect(r.replacements).toEqual([{ from: "El quejoso", to: "La quejosa" }]);
  });

  it("corrects the de-el/a-el contractions too, not just the bare article", () => {
    expect(
      remediatePartyGender("El argumento del quejoso fue considerado inoperante.", { quejoso: "f" })
        .text,
    ).toBe("El argumento de la quejosa fue considerado inoperante.");
    expect(remediatePartyGender("Se notificó al quejoso.", { quejoso: "f" }).text).toBe(
      "Se notificó a la quejosa.",
    );
  });

  it("corrects every mention in a multi-sentence finding, not just the first", () => {
    const r = remediatePartyGender("El quejoso alega X. El quejoso también sostiene Y.", {
      quejoso: "f",
    });
    expect(r.text).toBe("La quejosa alega X. La quejosa también sostiene Y.");
  });

  it("works in the reverse direction too, including re-contracting de la/a la back to del/al", () => {
    expect(remediatePartyGender("La quejosa alega X.", { quejoso: "m" }).text).toBe(
      "El quejoso alega X.",
    );
    expect(
      remediatePartyGender("El argumento de la quejosa fue considerado.", { quejoso: "m" }).text,
    ).toBe("El argumento del quejoso fue considerado.");
  });

  it("is a no-op when the corpus established nothing (empty gender map)", () => {
    const text = "El argumento del quejoso fue considerado.";
    expect(remediatePartyGender(text, {}).text).toBe(text);
  });
});
