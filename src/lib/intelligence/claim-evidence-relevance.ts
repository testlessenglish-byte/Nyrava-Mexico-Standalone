// Claim–Evidence Relevance Gate — pure module (no I/O, no AI).
//
// WHY: a finding can pass every other check this codebase already runs —
// the cited quote is verbatim and verified against the corpus
// (grounding.server.ts), the citation floor is satisfied (findings.server.ts),
// the category is correctly assigned (classify.server.ts) — and still be
// wrong in a way none of those catch: the quote is real, but it is about
// something else entirely, or it is too vacuous to substantively support
// anything.
//
// Two real, verified examples from a completed-case audit (ADR 4640/2017,
// Fabiola Romo Hernández — Amparo Directo en Revisión):
//   - A finding claiming "la autoridad responsable actuó dentro de su
//     competencia al emitir la resolución impugnada" cited a quote about a
//     judge's duty to address agravios ("congruencia y exhaustividad") —
//     verbatim, verified, and about a completely different legal question.
//   - Two findings claiming "el artículo 83 ... no viola el derecho a la
//     seguridad jurídica" cited "La respuesta a dicha interrogante es
//     negativa, como se expone a continuación" — a transitional sentence
//     with zero substantive content of its own; it doesn't establish
//     anything, on any topic.
//
// Calibrated against the same real export: every genuinely on-topic
// finding/quote pair in that case scored jaccard >= 0.04 on this metric;
// both real bad pairs above scored exactly 0.000 (zero shared substantive
// tokens). The threshold below is set conservatively below the lowest real
// GOOD score observed, specifically to avoid rejecting a legitimately
// related finding that happens to be heavily paraphrased — this gate is
// meant to catch quotes with NO topical relationship to their claim, not to
// second-guess normal paraphrasing.
//
// This is deliberately a lexical, deterministic check — not an embedding or
// NLI call. Every other verification gate in this codebase (grounding
// verification, duplicate-finding clustering, the citation floor) is the
// same: auditable, zero-latency, zero-API-cost, and its failure mode is
// legible — you can always see WHY a finding was flagged by looking at the
// actual shared/missing tokens, not a black-box similarity score. A true
// embedding model would catch cases this accidentally misses (heavy
// paraphrase with real relevance but low lexical overlap) or accidentally
// flags — noted as a real limitation, not silently glossed over.
//
// Materia-agnostic: no practice-area vocabulary is hard-coded here, so it
// behaves identically for penal, civil, laboral, amparo, etc. — same
// principle as finding-dedupe.ts, which this module reuses tokenization
// from directly (one tokenizer, not two that could drift apart).
//
// EXTENDED (2026-08-14) after a second real-report audit (ADR-2239-2018-
// 180906, a 1-document/minimal-corpus case) found the SAME failure class
// the module header above already names as a known limitation: a claim and
// its cited quote can share enough generic legal-boilerplate vocabulary —
// "autoridad", "resolución", "artículo", "garantía", "procesal" — to clear
// the plain Jaccard threshold while NOT actually sharing the specific legal
// concept the claim asserts (an "incompetencia de la autoridad" finding
// grounded in a quote about appeal-filing requirements; a "garantía de
// audiencia" finding grounded in a quote about the separate right to
// appeal). Note: the exact source text from that audit wasn't available to
// re-run the calibration this file's original threshold was tuned against
// (see CLAIM_EVIDENCE_RELEVANCE_THRESHOLD below, which is therefore left
// untouched rather than blindly raised) — this fix is a distinct,
// independently-reasoned safety net: it requires that whatever tokens the
// claim and quote share include at least one that ISN'T one of these
// generic legal terms. Two passages sharing ONLY generic legal vocabulary
// no longer counts as relevant, regardless of the raw Jaccard score.

import { normalizeText, tokens, jaccard } from "./finding-dedupe";

/** Legal-domain terms common enough to appear in almost any quote from a
 *  legal document, independent of subject matter — a match on ONLY these
 *  terms is not genuine topical relevance. Stemmed to the same 6-character
 *  truncation tokens() itself applies, so these compare directly against
 *  claimTokens/quoteTokens without re-tokenizing. Deliberately NOT added to
 *  finding-dedupe.ts's own STOPWORDS: that set drives duplicate-finding
 *  clustering, a different calibration this module must not disturb — see
 *  this file's tokenizer-reuse comment above.
 */
const GENERIC_LEGAL_TERMS = new Set([
  "garant", // garantía(s), garante, garantizar
  "proces", // procesal, proceso
  "articu", // artículo(s)
  "derech", // derecho(s)
  "autori", // autoridad(es)
  "resolu", // resolución, resolutivo
  "decisi", // decisión
  "recurs", // recurso(s)
  "instan", // instancia
  "materi", // materia
  "tribun", // tribunal
  "juzgad", // juzgado
  "codigo", // código
  "norma", // norma(s)
  "dispos", // disposición
  "impugn", // impugnar, impugnación
  "resolv", // resolver, resuelve
  "expedi", // expediente
  "consti", // constitución, constitucional
  "legal", // legal(es)
  "juridi", // jurídico
]);

/** Below the lowest real GOOD score observed in calibration (0.04) — see
 *  module header. Deliberately conservative: false negatives (a genuinely
 *  irrelevant quote that slips through) are far less costly than false
 *  positives (a real, correctly-cited finding rejected outright). */
export const CLAIM_EVIDENCE_RELEVANCE_THRESHOLD = 0.02;

/** Minimum substantive (non-stopword) tokens a quote must contain to be
 *  capable of supporting ANY claim at all. Catches purely transitional
 *  sentences ("La respuesta es negativa, como se expone a continuación")
 *  even in the (currently theoretical) case where such a sentence happened
 *  to share a stray token with the claim. */
const MIN_SUBSTANTIVE_QUOTE_TOKENS = 3;

export type ClaimEvidenceRelevance = {
  relevant: boolean;
  score: number;
  reason:
    | "ok"
    | "no_shared_vocabulary"
    | "only_generic_legal_overlap"
    | "quote_too_vacuous"
    | "no_quote";
};

/**
 * Checks whether a finding's claim (its title + description — what it
 * asserts) shares any real topical vocabulary with the quote cited to
 * support it. Returns `relevant: false` when the quote is off-topic (zero
 * meaningful token overlap), too vacuous to substantively support any claim
 * (too few non-stopword tokens of its own), or shares vocabulary with the
 * claim that consists ENTIRELY of generic legal boilerplate (see
 * GENERIC_LEGAL_TERMS above — the 2026-08-14 audit's failure mode: a real
 * proposition mismatch hiding behind shared words like "autoridad"/
 * "artículo"/"garantía" that say nothing about the SPECIFIC legal concept
 * asserted). Never asserts relevance for an empty quote — that's the
 * citation floor's job (findings.server.ts), not this gate's.
 */
export function checkClaimEvidenceRelevance(
  claimText: string,
  quoteText: string | null | undefined,
): ClaimEvidenceRelevance {
  const quote = String(quoteText ?? "").trim();
  if (!quote) return { relevant: false, score: 0, reason: "no_quote" };

  const quoteTokens = tokens(quote);
  if (quoteTokens.size < MIN_SUBSTANTIVE_QUOTE_TOKENS) {
    return { relevant: false, score: 0, reason: "quote_too_vacuous" };
  }

  const claimTokens = tokens(claimText);
  const score = jaccard(claimTokens, quoteTokens);
  if (score < CLAIM_EVIDENCE_RELEVANCE_THRESHOLD) {
    return { relevant: false, score, reason: "no_shared_vocabulary" };
  }

  const sharedTokens = [...claimTokens].filter((t) => quoteTokens.has(t));
  const hasDistinctiveOverlap = sharedTokens.some((t) => !GENERIC_LEGAL_TERMS.has(t));
  if (!hasDistinctiveOverlap) {
    return { relevant: false, score, reason: "only_generic_legal_overlap" };
  }

  return { relevant: true, score, reason: "ok" };
}

/** Convenience wrapper matching findings.server.ts's shape: a finding's
 *  claim is its title + description together (the description alone can be
 *  short enough that the title's vocabulary is needed to get a fair read). */
export function checkFindingEvidenceRelevance(
  finding: { title?: unknown; description?: unknown },
  quoteText: string | null | undefined,
): ClaimEvidenceRelevance {
  const claimText = `${String(finding.title ?? "")} ${String(finding.description ?? "")}`;
  return checkClaimEvidenceRelevance(claimText, quoteText);
}

// Re-exported so callers reasoning about this gate never need to also
// import normalizeText from finding-dedupe.ts directly.
export { normalizeText };
