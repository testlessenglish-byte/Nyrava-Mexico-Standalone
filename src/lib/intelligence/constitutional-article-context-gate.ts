// Constitutional Article Context Gate — pure module (no I/O, no AI).
//
// WHY: constitutional_issues[].articulo_cpeum is free LLM text with no
// verification today — verifyAndLabel (pipeline.server.ts) only confirms
// the item's cited QUOTE exists in the corpus, never that the ARTICLE
// NUMBER itself is the one that actually governs the underlying dispute.
// A quote can be 100% real and verified while the article cited alongside
// it is simply the wrong one — the two failure modes are independent, and
// this is exactly the class of bug this whole pipeline-wide sweep has been
// chasing: a citation that exists is not the same as a citation that is
// correct.
//
// Real case: Amparo Directo en Revisión 5829/2025 (ISSSTE tax-exemption
// dispute) cited "Art. 115, fracción IV" as the constitutional basis. CPEUM
// Art. 115 governs EXCLUSIVELY the hacienda municipal (municipal treasury)
// of the free municipio — the base of a STATE's territorial/political
// organization. It has no application to a federal parastatal entity
// (ISSSTE) or to Ciudad de México, which has no "municipios" at all (its
// own framework is CPEUM Art. 122). The report's own corpus never once
// mentioned "municipio" or "ayuntamiento" — the article was cited on the
// strength of a superficial topical similarity (both provisions concern
// property/payroll tax authority) rather than the one that actually
// governs this case.
//
// Deliberately a narrow, single-article denylist-style check, not a
// general "is this the correct constitutional article" engine — building
// that would be a substantive, open-ended legal-content judgment this
// codebase consistently defers to the user's own legal research (see
// domain-vocabulary-gate.ts's module header for the identical principle,
// applied there to institutional vocabulary instead of article numbers).
// This flags one specific, unambiguous, well-documented mismatch: an
// article whose ENTIRE subject matter is the municipio, cited with no
// municipio anywhere in the case. New rules should only be added here on
// the same standard — a real, reproduced case, not a hypothetical.
import { normalizeText } from "./claim-evidence-relevance";

type ArticleContextRule = {
  /** Matches the free-text article citation, e.g. "Art. 115, fracción IV". */
  articlePattern: RegExp;
  /** If the corpus text matches none of these, the citation is flagged. */
  requiredContext: RegExp;
  label: string;
};

const ARTICLE_CONTEXT_RULES: ArticleContextRule[] = [
  {
    articlePattern: /\bart(?:[íi]culo)?\.?\s*115\b/i,
    requiredContext: /\b(municipi\w*|ayuntamiento\w*)\b/i,
    label: "Art. 115 CPEUM (hacienda municipal — exclusivo de municipios)",
  },
];

export type ConstitutionalArticleContextCheck = {
  outOfContext: boolean;
  label: string | null;
};

/**
 * Checks whether a cited CPEUM article whose subject matter is exclusive to
 * a specific institution (e.g. Art. 115 → municipios) appears alongside
 * that institution anywhere in the case's own corpus text. Returns
 * `outOfContext: false` for any article not covered by a rule above — this
 * is a narrow, evidenced denylist, not a general correctness checker, so an
 * uncovered article is neither confirmed correct nor flagged wrong; it is
 * simply outside this gate's scope.
 */
export function checkConstitutionalArticleContext(
  articuloCpeum: string | null | undefined,
  corpusText: string,
): ConstitutionalArticleContextCheck {
  const article = String(articuloCpeum ?? "");
  if (!article.trim()) return { outOfContext: false, label: null };
  const haystack = normalizeText(corpusText ?? "");
  for (const rule of ARTICLE_CONTEXT_RULES) {
    if (!rule.articlePattern.test(article)) continue;
    if (!rule.requiredContext.test(haystack)) {
      return { outOfContext: true, label: rule.label };
    }
  }
  return { outOfContext: false, label: null };
}
