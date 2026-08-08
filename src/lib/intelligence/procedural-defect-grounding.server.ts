// Deterministic backstop for the "legal rule became a case finding" defect.
//
// The real fix lives in the prompt (see GROUNDING_CONTRACT_ES/EN in
// src/lib/mexico-lock.ts, injected into every analyzer/agent preamble): only
// the model, with the full document in front of it, can reliably tell a
// case-specific fact from a legal-rule citation. This module is a
// conservative, mechanical SECOND layer — it does not replace the prompt
// fix, it catches the clearest residual cases where a finding in a known
// procedural-defect category (notification, deadlines, jurisdiction,
// standing/definitividad, suspension, due process) survived the citation
// floor (some verbatim quote exists and verifies against the corpus) but
// that quote is, on its face, the text of a rule/article rather than a
// description of something that happened in this case.
//
// Deliberately narrow and false-negative-biased: it only downgrades when
// BOTH the finding's own text names a procedural-defect topic AND every
// verified quote attached to it lacks any case-specific marker (a date, a
// docket/expediente number, a named party/authority). A quote with a date
// or a proper-noun-shaped party name is left alone even if it also contains
// legal terminology — ambiguous cases are NOT this module's job; that
// judgment belongs to the prompt (which has the full corpus) or to a human
// reviewer, not to a regex.

/** Categories where "the law discusses X" gets mistaken for "X happened in
 * this case" — the exact failure pattern this module exists to catch.
 * Bilingual (Spanish/English) since case titles/descriptions can be either. */
const PROCEDURAL_DEFECT_TOPIC =
  /\b(notificaci[oó]n\s+defectuosa|notification\s+defect|falta\s+de\s+notificaci[oó]n|improper\s+(service|notification)|plazo\s+(incumplido|vencido)|missed\s+deadline|deadline\s+violation|falta\s+de\s+jurisdicci[oó]n|lack\s+of\s+jurisdiction|jurisdictional\s+defect|falta\s+de\s+competencia|incompetencia\s+de\s+la\s+autoridad|falta\s+de\s+(interés|interes)\s+(jur[ií]dico|leg[ií]timo)|lack\s+of\s+standing|falta\s+de\s+definitividad|failure\s+to\s+exhaust|agotamiento\s+de\s+recursos|defecto\s+de\s+suspensi[oó]n|suspension\s+(defect|violation)|violaci[oó]n\s+(procesal|al\s+debido\s+proceso|constitucional)|due[\s-]process\s+violation|constitutional\s+violation)\b/i;

/** Spanish month names, used to catch a written-out date ("nueve de abril de
 * dos mil veinticinco") — the way Mexican judicial resolutions actually
 * write dates. A digit-only date regex misses essentially every real date
 * in this corpus type. */
const SPANISH_MONTH = "(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)";

/** A marker that a passage is describing something that actually happened
 * (a written-out or digit date, a docket/expediente number, a year) rather
 * than reciting a norm in the abstract. Deliberately permissive — any hit is
 * enough to spare the quote from downgrade, because a false "this is
 * grounded" is far cheaper than a false "this is a bare rule" (which would
 * hide a real, well-evidenced finding). */
const CASE_SPECIFIC_MARKER = new RegExp(
  [
    // Written-out date: "nueve de abril de dos mil veinticinco" / mixed
    // digit-day form "9 de abril de 2025".
    `\\bde\\s+${SPANISH_MONTH}\\s+de\\s+(\\w+\\s+)?mil\\b`,
    `\\d{1,2}\\s+de\\s+${SPANISH_MONTH}\\s+de\\s+(19|20)\\d{2}`,
    // Digit dates and docket-style numbers: "22/08/2025", "692/2023", "5829/2025".
    `\\b\\d{1,4}\\/\\d{2,4}\\b`,
    `\\b(19|20)\\d{2}\\b`,
    `\\bexpediente\\s+\\d`,
    `\\bexp\\.\\s*\\d`,
    `\\bfolio\\s+\\d`,
    `\\bn[uú]mero\\s+\\d`,
    `\\btoca\\s+\\d`,
  ].join("|"),
  "i",
);

/** Deontic/normative phrasing typical of a statute or a doctrinal restatement
 * — "the law provides that", not "the following happened". Spanish-first
 * since the corpus is Mexican legal text; English variants covered too since
 * report_language can be "en". */
const NORMATIVE_PHRASING =
  /\b(deber[aá]n?|proced[eé]r?[aá]?|se\s+entiende\s+por|establece\s+que|dispone\s+que|se[ñn]ala\s+que|de\s+conformidad\s+con\s+el\s+art[ií]culo|conforme\s+al?\s+art[ií]culo|shall\s+be|must\s+comply|provides\s+that|requires\s+that)\b/i;

/** A bare article/law citation opener — the strongest single signal that a
 * quote IS the rule, not a case fact. */
const STATUTE_CITATION_OPENER =
  /^\s*(art(?:[ií]culo)?\.?\s*\d|ley\s+(de|general|federal|org[aá]nica)|c[oó]digo\s+(civil|penal|fiscal|de\s+comercio|nacional)|cpeum\b|constituci[oó]n\s+(pol[ií]tica)?)/i;

export type GroundingQuoteAssessment = {
  /** True only when the topic AND the quote-shape signals both fire —
   * conservative by construction, see module header. */
  isBareLegalRule: boolean;
  reason: string;
};

/**
 * Assess one finding's title/description against its verified quotes.
 * `quotes` should be every verbatim passage actually verified against the
 * corpus for this finding (not the raw, unverified evidence_refs) — an
 * unverified quote is already rejected upstream by the citation floor and
 * never reaches this check.
 */
export function assessProceduralDefectGrounding(args: {
  titleAndDescription: string;
  quotes: string[];
}): GroundingQuoteAssessment {
  const { titleAndDescription, quotes } = args;
  if (!PROCEDURAL_DEFECT_TOPIC.test(titleAndDescription)) {
    return { isBareLegalRule: false, reason: "not_a_procedural_defect_topic" };
  }
  const verified = quotes.map((q) => q.trim()).filter(Boolean);
  if (verified.length === 0) {
    // No quote at all is the citation floor's job to reject, not this
    // module's — treat as "nothing to assess" rather than a false positive.
    return { isBareLegalRule: false, reason: "no_quotes_to_assess" };
  }
  // Spared the moment ANY verified quote carries a case-specific marker —
  // a case can legitimately cite the rule AND the fact in separate refs.
  if (verified.some((q) => CASE_SPECIFIC_MARKER.test(q))) {
    return { isBareLegalRule: false, reason: "case_specific_marker_present" };
  }
  const allRuleShaped = verified.every(
    (q) => STATUTE_CITATION_OPENER.test(q) || NORMATIVE_PHRASING.test(q),
  );
  if (allRuleShaped) {
    return {
      isBareLegalRule: true,
      reason: "procedural_defect_topic_with_only_statute_shaped_quotes",
    };
  }
  return { isBareLegalRule: false, reason: "quote_shape_inconclusive" };
}
