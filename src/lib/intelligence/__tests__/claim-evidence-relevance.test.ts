// Regression test for the Claim-Evidence Relevance Gate (findings.server.ts's
// insert choke point + claim-evidence-relevance.ts). Two real production
// bugs found on a completed-case audit (ADR 4640/2017, Fabiola Romo
// Hernández — Amparo Directo en Revisión):
//   1. A finding claiming "la autoridad responsable actuó dentro de su
//      competencia al emitir la resolución impugnada" cited a quote about a
//      judge's duty to address agravios (congruencia y exhaustividad) — a
//      completely different legal question, verbatim and verified but
//      off-topic.
//   2. Two findings claiming "el artículo 83 ... no viola el derecho a la
//      seguridad jurídica" cited "La respuesta a dicha interrogante es
//      negativa, como se expone a continuación" — a transitional sentence
//      with no substantive content of its own.
// Both real bad pairs score exactly 0 on this metric; every genuinely
// on-topic pair from the same real export — including a heavily paraphrased
// one that shares only "agravios" — scores above the threshold. That real
// separation is what CLAIM_EVIDENCE_RELEVANCE_THRESHOLD is calibrated
// against; this test locks that calibration in.
import { describe, it, expect } from "vitest";
import { checkClaimEvidenceRelevance } from "../claim-evidence-relevance";

describe("checkClaimEvidenceRelevance", () => {
  it("rejects a real off-topic citation (competencia claim, congruencia quote)", () => {
    const r = checkClaimEvidenceRelevance(
      "La autoridad responsable actuó dentro de su competencia al emitir la resolución impugnada.",
      "la obligación del juzgador es atenerse a lo planteado por el recurrente en su escrito de agravios",
    );
    expect(r.relevant).toBe(false);
    expect(r.reason).toBe("no_shared_vocabulary");
  });

  it("rejects a real vacuous citation (transitional sentence, no substantive content)", () => {
    const r = checkClaimEvidenceRelevance(
      "El tribunal concluye que el artículo 83 no viola el derecho a la seguridad jurídica al no requerir la transcripción de agravios en las sentencias de apelación.",
      "La respuesta a dicha interrogante es negativa, como se expone a continuación.",
    );
    expect(r.relevant).toBe(false);
  });

  it("accepts a real on-topic citation with strong lexical overlap", () => {
    const r = checkClaimEvidenceRelevance(
      "El argumento de la recurrente sobre la violación de su derecho al debido proceso fue considerado inoperante por no haber sido planteado en la demanda de amparo.",
      "pues constituye un argumento novedoso que al no haber sido planteado desde la demanda de amparo no procede su estudio.",
    );
    expect(r.relevant).toBe(true);
    expect(r.reason).toBe("ok");
  });

  it("accepts a real on-topic citation even when heavily paraphrased (low but nonzero overlap)", () => {
    const r = checkClaimEvidenceRelevance(
      "La sentencia no aborda adecuadamente los agravios planteados por el quejoso, lo que podría constituir una violación al derecho de defensa.",
      "la obligación del juzgador es atenerse a lo planteado por el recurrente en su escrito de agravios y contestar cada uno de ellos de conformidad con los principios de congruencia y exhaustividad",
    );
    expect(r.relevant).toBe(true);
  });

  it("never asserts relevance for a missing quote — that is the citation floor's job, not this gate's", () => {
    const r = checkClaimEvidenceRelevance("Some claim", "");
    expect(r.relevant).toBe(false);
    expect(r.reason).toBe("no_quote");
  });

  it("flags an overly short/vacuous quote directly, independent of topical overlap", () => {
    const r = checkClaimEvidenceRelevance("Cualquier afirmación jurídica", "Sí.");
    expect(r.relevant).toBe(false);
    expect(r.reason).toBe("quote_too_vacuous");
  });
});
