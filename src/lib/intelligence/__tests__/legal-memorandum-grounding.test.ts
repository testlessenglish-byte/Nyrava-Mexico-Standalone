// Real-user bug report (2026-08-16), reproduction #2: "a specific statute
// citation appears to be fabricated." legal_memorandum.legal_analysis[1].rule
// read "...según lo establecido en el artículo 61 de la Ley de Amparo
// [DOC 1 p.12]." — a specific statute number that does not appear anywhere
// in the real 18-page source, on page 12 or otherwise. Doc 1 is real and
// page 12 is in range, so the pre-existing orphaned-citations scan (which
// only checks the (doc, page) pair exists) passed it. This is the first
// check that actually verifies the cited page's real text supports the
// specific article number the claim names.
//
// A general topical-overlap check (claim-evidence-relevance.ts's Jaccard
// approach) was tried first here and rejected: the fabricated sentence and
// the real page genuinely share topical vocabulary ("legitimación del
// promovente" appears on both), so a topical check calls the pair
// "relevant" even though the specific fabricated detail — the article
// number — isn't there. This module checks the specific claim instead.
import { describe, it, expect } from "vitest";
import {
  checkLegalMemorandumFieldGrounding,
  gateLegalAnalysis,
  gateRecommendedMotions,
  gateEvidenceAppendix,
  gateStatementOfFacts,
} from "@/lib/intelligence/legal-memorandum-grounding";
import { buildGroundingCorpus, verifyQuote } from "@/lib/intelligence/grounding.server";
import { checkClaimEvidenceRelevance } from "@/lib/intelligence/claim-evidence-relevance";

// Real page 12 text (paraphrased-length excerpt matching real document_pages
// storage) — discusses legitimación del promovente, same topic as the
// fabricated sentence, but never mentions "artículo 61" or any article 61.
const REAL_PAGE_12_TEXT =
  "El principio de congruencia y exhaustividad exige que las sentencias de amparo sean congruentes consigo mismas y con la litis, lo que implica que el juzgador debe atender todos los argumentos presentados por el quejoso. La falta de una argumentación clara sobre la legitimación del promovente podría ser un punto débil en la defensa del quejoso.";

const REAL_PAGE_5_TEXT =
  "Artículo 75. En las sentencias que se dicten en los juicios de amparo el acto reclamado se apreciará tal y como aparezca probado ante la autoridad responsable, garantizando así el acceso a la justicia y la tutela judicial efectiva.";

describe("checkLegalMemorandumFieldGrounding", () => {
  it("flags a fabricated article number — the exact real-case reproduction", () => {
    const rule =
      "La falta de argumentación sobre la legitimación del promovente puede ser causal de improcedencia del amparo, según lo establecido en el artículo 61 de la Ley de Amparo [DOC 1 p.12].";
    const pageTextByKey = new Map([["1:12", REAL_PAGE_12_TEXT]]);

    const result = checkLegalMemorandumFieldGrounding(rule, pageTextByKey);

    expect(result.grounded).toBe(false);
    expect(result.checkedCitations).toBe(1);
    expect(result.ungroundedCitations).toHaveLength(1);
    expect(result.ungroundedCitations[0]).toMatchObject({ docN: 1, page: 12, articleRef: "61" });
  });

  it("does not flag a real article number the cited page actually contains", () => {
    const rule =
      "El artículo 75 de la Ley de Amparo establece que el acto reclamado se apreciará tal y como fue probado ante la autoridad responsable [DOC 1 p.5].";
    const pageTextByKey = new Map([["1:5", REAL_PAGE_5_TEXT]]);

    const result = checkLegalMemorandumFieldGrounding(rule, pageTextByKey);

    expect(result.grounded).toBe(true);
    expect(result.checkedCitations).toBe(1);
  });

  it("does not count or flag a citation whose sentence names no specific article number", () => {
    const rule =
      "El principio de congruencia y exhaustividad exige que las sentencias de amparo sean congruentes con la litis [DOC 1 p.12].";
    const result = checkLegalMemorandumFieldGrounding(rule, new Map([["1:12", REAL_PAGE_12_TEXT]]));
    expect(result.checkedCitations).toBe(0);
    expect(result.grounded).toBe(true);
  });

  it("skips sentences with no citation marker entirely", () => {
    const result = checkLegalMemorandumFieldGrounding(
      "El artículo 61 no tiene ninguna cita adjunta.",
      new Map([["1:12", REAL_PAGE_12_TEXT]]),
    );
    expect(result.checkedCitations).toBe(0);
    expect(result.grounded).toBe(true);
  });

  it("skips a citation whose page text isn't available (that's the orphaned-citations scan's job, not this gate's)", () => {
    const result = checkLegalMemorandumFieldGrounding(
      "El artículo 12 establece una afirmación cualquiera [DOC 9 p.99].",
      new Map([["1:12", REAL_PAGE_12_TEXT]]),
    );
    expect(result.checkedCitations).toBe(0);
    expect(result.grounded).toBe(true);
  });
});

describe("gateLegalAnalysis", () => {
  it("drops the fabricated legal_analysis entry, keeps the grounded one", () => {
    const items = [
      {
        issue: "Si la falta de legitimación afecta la procedencia del amparo.",
        rule: "La falta de argumentación sobre la legitimación del promovente puede ser causal de improcedencia del amparo, según lo establecido en el artículo 61 de la Ley de Amparo [DOC 1 p.12].",
        application: "En este caso, la quejosa no ha presentado una argumentación clara sobre su legitimación.",
        conclusion: "La falta de argumentación sobre la legitimación del promovente es una debilidad significativa.",
      },
      {
        issue: "Si el artículo 75 de la Ley de Amparo limita el derecho de acceso a la justicia.",
        rule: "El artículo 75 de la Ley de Amparo establece que el acto reclamado se apreciará tal y como fue probado ante la autoridad responsable [DOC 1 p.5].",
        application: "La SCJN ha determinado que el artículo 75 no constituye un obstáculo para el acceso a la justicia.",
        conclusion: "El artículo 75 de la Ley de Amparo no limita el derecho de acceso a la justicia.",
      },
    ];
    const pageTextByKey = new Map([
      ["1:12", REAL_PAGE_12_TEXT],
      ["1:5", REAL_PAGE_5_TEXT],
    ]);

    const { items: kept, droppedCount } = gateLegalAnalysis(items, pageTextByKey);

    expect(droppedCount).toBe(1);
    expect(kept).toHaveLength(1);
    expect(kept[0].issue).toContain("artículo 75");
  });

  it("leaves an entry with no inline citation untouched (a different, out-of-scope problem)", () => {
    const items = [{ issue: "x", rule: "Sin ninguna cita aquí.", application: "y", conclusion: "z" }];
    const { items: kept, droppedCount } = gateLegalAnalysis(items, new Map());
    expect(droppedCount).toBe(0);
    expect(kept).toHaveLength(1);
  });
});

// Pipeline-wide sweep (2026-08-17) found legal_memorandum.recommended_motions
// had ZERO verification of any kind — unlike its sibling motion_opportunities.
// draft_paragraph is explicitly prompted as "a ready-to-file paragraph," the
// single most directly exploitable field in the whole legal_memorandum.
describe("gateRecommendedMotions", () => {
  const corpus = buildGroundingCorpus([
    { id: "doc-1", filename: "resolucion.pdf", extracted_text: REAL_PAGE_12_TEXT },
  ]);
  const pageTextByKey = new Map([["1:12", REAL_PAGE_12_TEXT]]);

  it("drops a motion whose factual_basis is entirely fabricated — no entry verifies against the real corpus", () => {
    const items = [
      {
        motion: "Amparo indirecto",
        legal_standard: "Procede conforme al artículo 107 de la Ley de Amparo.",
        factual_basis: [
          "El quejoso presentó pruebas irrefutables el 5 de mayo de 2020 ante el juzgado de distrito.",
        ],
        draft_paragraph: "Por lo anteriormente expuesto, se solicita...",
      },
    ];
    const { items: kept, droppedCount } = gateRecommendedMotions(items, pageTextByKey, verifyQuote, corpus);
    expect(droppedCount).toBe(1);
    expect(kept).toHaveLength(0);
  });

  it("keeps a motion whose factual_basis genuinely verifies against the real corpus", () => {
    const items = [
      {
        motion: "Recurso de revisión",
        legal_standard: "Sin cita de artículo específico.",
        factual_basis: [REAL_PAGE_12_TEXT.slice(0, 60)],
        draft_paragraph: "Por lo anteriormente expuesto...",
      },
    ];
    const { items: kept, droppedCount } = gateRecommendedMotions(items, pageTextByKey, verifyQuote, corpus);
    expect(droppedCount).toBe(0);
    expect(kept).toHaveLength(1);
  });

  it("drops a motion with a verified fact but a fabricated article-number citation in draft_paragraph — the exact real-case reproduction, applied to the sibling field", () => {
    const items = [
      {
        motion: "Recurso de revisión",
        legal_standard: "Procede.",
        factual_basis: [REAL_PAGE_12_TEXT.slice(0, 60)],
        draft_paragraph:
          "Conforme al artículo 61 de la Ley de Amparo [DOC 1 p.12], se solicita la revocación del acto reclamado.",
      },
    ];
    const { items: kept, droppedCount } = gateRecommendedMotions(items, pageTextByKey, verifyQuote, corpus);
    expect(droppedCount).toBe(1);
    expect(kept).toHaveLength(0);
  });

  it("drops a motion with no factual_basis array at all", () => {
    const items = [{ motion: "x", legal_standard: "y", draft_paragraph: "z" }];
    const { items: kept, droppedCount } = gateRecommendedMotions(items, pageTextByKey, verifyQuote, corpus);
    expect(droppedCount).toBe(1);
    expect(kept).toHaveLength(0);
  });
});

// Pipeline-wide sweep (2026-08-17): legal_memorandum.evidence_appendix had a
// key_quote field but no verification of any kind — the schema has no doc_n
// (just a free-text "page" string), so this checks the quote against the
// whole real corpus, the same standard gateRecommendedMotions' factual_basis
// check uses.
describe("gateEvidenceAppendix", () => {
  const corpus = buildGroundingCorpus([
    { id: "doc-1", filename: "resolucion.pdf", extracted_text: REAL_PAGE_12_TEXT },
  ]);

  it("drops an entry whose key_quote is fabricated — never appears in the real corpus", () => {
    const items = [
      {
        exhibit: "Anexo 1",
        description: "Constancia de notificación",
        page: "12",
        key_quote: "Esta frase no existe en ningún documento real del expediente.",
        proves: "Que la notificación fue defectuosa",
        admissibility_risk: "Low",
      },
    ];
    const { items: kept, droppedCount } = gateEvidenceAppendix(items, verifyQuote, corpus);
    expect(droppedCount).toBe(1);
    expect(kept).toHaveLength(0);
  });

  it("keeps an entry whose key_quote genuinely verifies against the real corpus", () => {
    const items = [
      {
        exhibit: "Anexo 1",
        description: "Resolución de amparo",
        page: "12",
        key_quote: REAL_PAGE_12_TEXT.slice(0, 60),
        proves: "El principio de congruencia y exhaustividad",
        admissibility_risk: "Low",
      },
    ];
    const { items: kept, droppedCount } = gateEvidenceAppendix(items, verifyQuote, corpus);
    expect(droppedCount).toBe(0);
    expect(kept).toHaveLength(1);
  });

  it("drops an entry with no key_quote at all", () => {
    const items = [{ exhibit: "x", description: "y", page: "1", proves: "z", admissibility_risk: "Low" }];
    const { items: kept, droppedCount } = gateEvidenceAppendix(items, verifyQuote, corpus);
    expect(droppedCount).toBe(1);
    expect(kept).toHaveLength(0);
  });
});

// Pipeline-wide sweep (2026-08-17): legal_memorandum.statement_of_facts
// entries are the attorney's own paraphrased restatement of a fact (not
// verbatim quotes), each expected to embed an inline [DOC N p.M] marker per
// the prompt instruction. checkClaimEvidenceRelevance (topical overlap) is
// the right check here — verifyQuote would reject legitimate paraphrases.
describe("gateStatementOfFacts", () => {
  const pageTextByKey = new Map([["1:12", REAL_PAGE_12_TEXT]]);

  it("drops a fact entirely unrelated to its cited page's real topic", () => {
    const statementOfFacts = {
      undisputed: [
        "Las partes acordaron una pensión alimenticia mensual de $5,000 pesos para los menores [DOC 1 p.12].",
      ],
      disputed: [],
      chronology: [],
    };
    const { statementOfFacts: out, droppedCount } = gateStatementOfFacts(
      statementOfFacts,
      pageTextByKey,
      checkClaimEvidenceRelevance,
    );
    expect(droppedCount).toBe(1);
    expect(out?.undisputed).toHaveLength(0);
  });

  it("keeps a fact genuinely on-topic with its cited page", () => {
    const statementOfFacts = {
      undisputed: [
        "El tribunal debe atender el principio de congruencia y exhaustividad respecto a la legitimación del promovente [DOC 1 p.12].",
      ],
      disputed: [],
      chronology: [],
    };
    const { statementOfFacts: out, droppedCount } = gateStatementOfFacts(
      statementOfFacts,
      pageTextByKey,
      checkClaimEvidenceRelevance,
    );
    expect(droppedCount).toBe(0);
    expect(out?.undisputed).toHaveLength(1);
  });

  it("leaves a fact with no citation marker untouched — nothing to check", () => {
    const statementOfFacts = {
      undisputed: ["Un hecho sin ninguna cita adjunta."],
      disputed: [],
      chronology: [],
    };
    const { statementOfFacts: out, droppedCount } = gateStatementOfFacts(
      statementOfFacts,
      pageTextByKey,
      checkClaimEvidenceRelevance,
    );
    expect(droppedCount).toBe(0);
    expect(out?.undisputed).toEqual(["Un hecho sin ninguna cita adjunta."]);
  });

  it("leaves a fact whose cited page has no text available untouched — can't verify, don't penalize", () => {
    const statementOfFacts = {
      undisputed: ["Un hecho cualquiera con una cita a una página sin texto [DOC 9 p.99]."],
      disputed: [],
      chronology: [],
    };
    const { statementOfFacts: out, droppedCount } = gateStatementOfFacts(
      statementOfFacts,
      pageTextByKey,
      checkClaimEvidenceRelevance,
    );
    expect(droppedCount).toBe(0);
    expect(out?.undisputed).toHaveLength(1);
  });

  it("returns null/undefined statement_of_facts unchanged", () => {
    expect(gateStatementOfFacts(null, pageTextByKey, checkClaimEvidenceRelevance)).toEqual({
      statementOfFacts: null,
      droppedCount: 0,
    });
  });
});
