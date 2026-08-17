// Legal Memorandum Citation Grounding — pure module (no I/O; callers pass in
// the real per-page text already queried from document_pages).
//
// WHY: legal_memorandum (the IRAC legal_analysis, recommended_motions, and
// risk_matrix sections of the report) is produced by its own, entirely
// separate LLM call (pipeline.server.ts's "memo" chunk) and — unlike every
// other structured report section — never passes through ANY citation or
// claim verification:
//   - verifyAndLabel (pipeline.server.ts) only applies to contradictions/
//     motion_opportunities/constitutional_issues, whose citations are
//     {doc_n, quote} objects it can substring-match. legal_analysis's own
//     `cited_evidence` field is a plain string array ("DOC 1 p.12"), not
//     quote objects, so that mechanism can't reach it.
//   - enforceStructuredItems/enforceProse (claim-strength.server.ts) are
//     only ever called on contradictions/motions/constIssues/missingEvidence
//     and a fixed list of narrative prose fields — legal_memorandum's own
//     fields are not in either list.
//   - The existing "orphaned citations" scan (pipeline.server.ts) checks
//     every [DOC N p.M] marker anywhere in the report, including inside
//     legal_memorandum — but only verifies the (doc, page) PAIR EXISTS
//     (real document, real page number in range), never that the cited
//     page's actual text supports the specific claim next to the marker.
//
// Confirmed live on a real case (ADR-2239-2018): legal_analysis[1].rule
// read "...según lo establecido en el artículo 61 de la Ley de Amparo
// [DOC 1 p.12]." — a specific statute number that does not appear anywhere
// in the 18-page source, on page 12 or otherwise. Doc 1 is real, page 12
// is in range, so the orphaned-citation scan passed it; the underlying
// finding this traced to had finding_type "AI_THEORY", verification_status
// "no_citation", and evidence_refs: [] — the pipeline had already
// determined this exact proposition was unverified, just never carried
// that determination into the memo's own generation.
//
// SCOPE (deliberately narrow): this checks a specific, well-defined failure
// pattern — a sentence citing [DOC N p.M] that also names a specific
// "artículo NN" the cited page does not actually mention — not general
// semantic entailment between a claim and its source. A generic topical-
// overlap check (e.g. reusing claim-evidence-relevance.ts's Jaccard
// approach) was tried first and rejected: it correctly found the fabricated
// sentence and the real page share genuine topical vocabulary ("legitimación
// del promovente" appears on both), so it call the pair "relevant" even
// though the specific fabricated detail — the article number itself — isn't
// there. Catching that requires checking the specific claim, not the
// surrounding topic. A general claim-vs-source entailment checker is real,
// useful, future work (already named as deferred elsewhere in this codebase)
// — this is the bounded, low-false-positive slice of it that's buildable
// deterministically today.
import type { GroundingCorpus } from "./grounding.server";

const CITATION_RE = /\[DOC\s+(\d+)\s+p\.(\d+)\]/g;
const ARTICLE_REF_RE = /\bart(?:[íi]culo)?s?\.?\s+(\d+)\b/gi;

// How far back from a [DOC N p.M] marker to look for the article number it's
// citing. A sentence-splitter was tried first here and rejected: splitting
// on periods breaks the marker itself apart ("p." reads as a sentence
// ending), so "[DOC 1 p.12]" ends up split across two "sentences" and the
// marker is never seen intact. A fixed preceding window sidesteps that.
const CONTEXT_WINDOW_CHARS = 200;

/** Every distinct "artículo N" / "art. N" reference named in a text window. */
function extractArticleRefs(text: string): string[] {
  return [...text.matchAll(ARTICLE_REF_RE)].map((m) => m[1]);
}

/** True if the page's real text mentions this exact article number as an article reference. */
function pageHasArticleRef(pageText: string, articleNum: string): boolean {
  const re = new RegExp(`art(?:[íi]culo)?s?\\.?\\s+${articleNum}\\b`, "i");
  return re.test(pageText);
}

export type CitationGroundingCheck = {
  grounded: boolean;
  checkedCitations: number;
  ungroundedCitations: Array<{ docN: number; page: number; articleRef: string; sentence: string }>;
};

/**
 * Checks every inline [DOC N p.M] citation in `text` whose sentence ALSO
 * names a specific article number against the real text of the page it
 * cites (`pageTextByKey`, keyed "docN:page"). A citation with no article
 * reference, or whose page has no entry in `pageTextByKey`, contributes
 * nothing to checkedCitations — there is nothing this gate can verify for
 * it, so it is neither flagged nor counted (never penalized for something
 * this gate couldn't actually check).
 */
export function checkLegalMemorandumFieldGrounding(
  text: string,
  pageTextByKey: Map<string, string>,
): CitationGroundingCheck {
  const ungroundedCitations: CitationGroundingCheck["ungroundedCitations"] = [];
  let checkedCitations = 0;
  for (const m of text.matchAll(CITATION_RE)) {
    const matchIndex = m.index ?? 0;
    const contextStart = Math.max(0, matchIndex - CONTEXT_WINDOW_CHARS);
    const context = text.slice(contextStart, matchIndex);
    const articleRefs = extractArticleRefs(context);
    if (!articleRefs.length) continue;
    const docN = Number(m[1]);
    const page = Number(m[2]);
    const pageText = pageTextByKey.get(`${docN}:${page}`);
    if (!pageText) continue;
    for (const articleNum of articleRefs) {
      checkedCitations++;
      if (!pageHasArticleRef(pageText, articleNum)) {
        ungroundedCitations.push({ docN, page, articleRef: articleNum, sentence: context.trim() });
      }
    }
  }
  return { grounded: ungroundedCitations.length === 0, checkedCitations, ungroundedCitations };
}

/**
 * Gates legal_memorandum.legal_analysis: drops any IRAC entry whose rule/
 * application/conclusion cites a real (doc, page) pair while naming a
 * specific article number that page's actual text does not mention. Entries
 * with no such citation, or whose citation couldn't be checked, are left
 * untouched.
 */
export function gateLegalAnalysis(
  items: Array<Record<string, unknown>>,
  pageTextByKey: Map<string, string>,
  fields: string[] = ["rule", "application", "conclusion"],
): { items: Array<Record<string, unknown>>; droppedCount: number } {
  const kept: Array<Record<string, unknown>> = [];
  let droppedCount = 0;
  for (const item of items) {
    let hasUngroundedCitation = false;
    for (const f of fields) {
      const v = item[f];
      if (typeof v !== "string" || !v.trim()) continue;
      const check = checkLegalMemorandumFieldGrounding(v, pageTextByKey);
      if (check.checkedCitations > 0 && !check.grounded) {
        hasUngroundedCitation = true;
        break;
      }
    }
    if (hasUngroundedCitation) {
      droppedCount++;
      continue;
    }
    kept.push(item);
  }
  return { items: kept, droppedCount };
}

/**
 * Gates legal_memorandum.recommended_motions — a section survey (2026-08-17)
 * found had ZERO verification of any kind, unlike its sibling
 * motion_opportunities (pipeline.server.ts's verifyAndLabel + claim-strength
 * guardrail). Each motion's `draft_paragraph` is explicitly prompted as
 * "a ready-to-file paragraph" with inline citations — the most directly
 * exploitable field in the whole legal_memorandum, since an attorney could
 * file it as-is. Two checks:
 *   1. `factual_basis` (an array of quote strings, unlike legal_analysis's
 *      single-string fields) must contain at least one entry that actually
 *      verifies against the real corpus (`verifyQuote`) — motions whose
 *      every factual_basis entry is unverifiable are dropped entirely, the
 *      same "drop, don't publish" policy pipeline.server.ts's verifyAndLabel
 *      already applies to motion_opportunities/contradictions/
 *      constitutional_issues.
 *   2. `legal_standard`/`draft_paragraph` are checked with the same
 *      fabricated-article-number gate legal_analysis already uses — a
 *      draft_paragraph is exactly where a fabricated "artículo NN" citation
 *      would do the most damage if filed.
 */
export function gateRecommendedMotions(
  items: Array<Record<string, unknown>>,
  pageTextByKey: Map<string, string>,
  verifyQuote: (quote: string, corpus: GroundingCorpus) => boolean,
  corpus: GroundingCorpus,
): { items: Array<Record<string, unknown>>; droppedCount: number } {
  const kept: Array<Record<string, unknown>> = [];
  let droppedCount = 0;
  for (const item of items) {
    const factualBasis = Array.isArray(item.factual_basis)
      ? (item.factual_basis as unknown[]).filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      : [];
    const hasVerifiedFact = factualBasis.length > 0 && factualBasis.some((q) => verifyQuote(q, corpus));
    if (!hasVerifiedFact) {
      droppedCount++;
      continue;
    }
    let hasUngroundedCitation = false;
    for (const f of ["legal_standard", "draft_paragraph"]) {
      const v = item[f];
      if (typeof v !== "string" || !v.trim()) continue;
      const check = checkLegalMemorandumFieldGrounding(v, pageTextByKey);
      if (check.checkedCitations > 0 && !check.grounded) {
        hasUngroundedCitation = true;
        break;
      }
    }
    if (hasUngroundedCitation) {
      droppedCount++;
      continue;
    }
    kept.push(item);
  }
  return { items: kept, droppedCount };
}

/**
 * Gates legal_memorandum.evidence_appendix — the last legal_memorandum
 * section a pipeline-wide sweep (2026-08-17) found had zero verification.
 * Unlike recommended_motions/legal_analysis, this schema has no doc_n field
 * to pin a page-specific check to (just a free-text "page" string) — so this
 * checks key_quote against the real corpus as a whole, the same standard
 * gateRecommendedMotions' factual_basis check uses. proves/admissibility_risk
 * are legal conclusions that depend entirely on key_quote being real; if the
 * quote doesn't exist, the whole entry is dropped.
 */
export function gateEvidenceAppendix(
  items: Array<Record<string, unknown>>,
  verifyQuote: (quote: string, corpus: GroundingCorpus) => boolean,
  corpus: GroundingCorpus,
): { items: Array<Record<string, unknown>>; droppedCount: number } {
  const kept: Array<Record<string, unknown>> = [];
  let droppedCount = 0;
  for (const item of items) {
    const quote = item.key_quote;
    if (typeof quote === "string" && quote.trim().length > 0 && verifyQuote(quote, corpus)) {
      kept.push(item);
    } else {
      droppedCount++;
    }
  }
  return { items: kept, droppedCount };
}

/**
 * Gates legal_memorandum.statement_of_facts.{undisputed,disputed,chronology}
 * — plain string arrays (unlike recommended_motions/legal_analysis, which
 * have dedicated citation fields), each sentence expected to embed its own
 * inline [DOC N p.M] marker per the prompt instruction ("Every fact in
 * statement_of_facts... MUST use the same [DOC N p.M] pinpoint-citation
 * format"). These are the attorney's OWN paraphrased restatement of a fact,
 * not verbatim quotes — checking them against the corpus with verifyQuote
 * (exact/near-exact substring matching) would reject legitimate paraphrases
 * wholesale. checkClaimEvidenceRelevance (claim-evidence-relevance.ts) is
 * the right tool here instead: a topical-overlap check between the claim and
 * the cited page's real text, deliberately calibrated to accept genuine
 * paraphrases while catching a fact with NO relationship to what the cited
 * page actually discusses. This is a DIFFERENT use of that module than the
 * one deliberately rejected in gateLegalAnalysis's header comment — that
 * case needed to catch a SPECIFIC fabricated detail (an article number)
 * hiding inside an otherwise-topically-relevant sentence, which topical
 * overlap structurally cannot do; this case only needs to confirm the fact
 * is even about the same subject as its citation, which is exactly what
 * topical overlap is calibrated for.
 * A sentence with no [DOC N p.M] marker at all, or whose cited page has no
 * text available, is left untouched — nothing to check, so nothing is
 * penalized, matching every other gate in this file.
 */
export function gateStatementOfFacts(
  statementOfFacts: Record<string, unknown> | null | undefined,
  pageTextByKey: Map<string, string>,
  checkRelevance: (claimText: string, quoteText: string | null | undefined) => { relevant: boolean },
): { statementOfFacts: Record<string, unknown> | null | undefined; droppedCount: number } {
  if (!statementOfFacts || typeof statementOfFacts !== "object") {
    return { statementOfFacts, droppedCount: 0 };
  }
  let droppedCount = 0;
  const gateList = (arr: unknown): unknown[] => {
    if (!Array.isArray(arr)) return arr as unknown[];
    return arr.filter((entry) => {
      if (typeof entry !== "string" || !entry.trim()) return true;
      const matches = [...entry.matchAll(CITATION_RE)];
      if (matches.length === 0) return true;
      for (const m of matches) {
        const docN = Number(m[1]);
        const page = Number(m[2]);
        const pageText = pageTextByKey.get(`${docN}:${page}`);
        if (!pageText) continue;
        if (!checkRelevance(entry, pageText).relevant) {
          droppedCount++;
          return false;
        }
      }
      return true;
    });
  };
  const out = {
    ...statementOfFacts,
    undisputed: gateList(statementOfFacts.undisputed),
    disputed: gateList(statementOfFacts.disputed),
    chronology: gateList(statementOfFacts.chronology),
  };
  return { statementOfFacts: out, droppedCount };
}
