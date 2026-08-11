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

import { normalizeText, tokens, jaccard } from "./finding-dedupe";

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
  reason: "ok" | "no_shared_vocabulary" | "quote_too_vacuous" | "no_quote";
};

/**
 * Checks whether a finding's claim (its title + description — what it
 * asserts) shares any real topical vocabulary with the quote cited to
 * support it. Returns `relevant: false` when the quote is either
 * off-topic (zero meaningful token overlap) or too vacuous to substantively
 * support any claim (too few non-stopword tokens of its own) — the two real
 * failure modes found in production. Never asserts relevance for an empty
 * quote — that's the citation floor's job (findings.server.ts), not this
 * gate's.
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
