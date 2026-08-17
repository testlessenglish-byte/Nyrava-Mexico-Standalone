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
} from "@/lib/intelligence/legal-memorandum-grounding";

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
