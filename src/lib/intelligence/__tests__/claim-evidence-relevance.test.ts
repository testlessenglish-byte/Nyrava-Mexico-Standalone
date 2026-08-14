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

// Second real-report audit (2026-08-14, ADR-2239-2018-180906, a 1-document/
// minimal-corpus case) found the SAME failure class this module already
// names as a known limitation: a claim and quote sharing only GENERIC legal
// boilerplate ("autoridad", "artículo", "garantía", "resolución") clear the
// plain Jaccard threshold without sharing the actual legal concept asserted.
// The exact source document from that audit wasn't available to reproduce
// verbatim (unlike the ADR 4640/2017 cases above, calibrated directly
// against the real export) — these cases are representative reconstructions
// of the described failure SHAPE ("incompetencia" grounded in an appeal-
// filing-requirements quote; "garantía de audiencia" grounded in an
// appeal-rights quote), built to prove the new distinctive-overlap
// requirement actually closes this class of gap, not to claim they are the
// literal audited text.
describe("checkClaimEvidenceRelevance — generic-legal-overlap-only rejection", () => {
  it("rejects an 'incompetencia de la autoridad' claim grounded only in a quote about appeal-filing requirements", () => {
    const r = checkClaimEvidenceRelevance(
      "Incompetencia de la autoridad responsable para emitir la resolución impugnada, al carecer de facultades territoriales y materiales para conocer del asunto.",
      "El recurso de apelación deberá interponerse por escrito ante la autoridad que emitió la resolución, dentro del plazo señalado, cumpliendo los requisitos previstos en el artículo correspondiente.",
    );
    expect(r.relevant).toBe(false);
    expect(r.reason).toBe("only_generic_legal_overlap");
  });

  it("rejects a 'garantía de audiencia' claim grounded only in a quote about the separate right to appeal", () => {
    const r = checkClaimEvidenceRelevance(
      "Vulneración a la garantía de audiencia, al no haberse otorgado al quejoso la oportunidad de ser oído previamente a la emisión del acto de autoridad.",
      "Se establece como garantía procesal la posibilidad de apelar o impugnar la decisión adoptada en una primera instancia ante un tribunal superior.",
    );
    expect(r.relevant).toBe(false);
    expect(r.reason).toBe("only_generic_legal_overlap");
  });

  it("still accepts a claim and quote sharing distinctive, non-generic vocabulary even alongside generic legal terms", () => {
    const r = checkClaimEvidenceRelevance(
      "Vulneración a la garantía de audiencia, al no haberse notificado al quejoso previamente a la emisión del acto de autoridad.",
      "La autoridad omitió notificar personalmente al interesado antes de dictar la resolución, impidiéndole ser oído en el procedimiento.",
    );
    expect(r.relevant).toBe(true);
  });
});
