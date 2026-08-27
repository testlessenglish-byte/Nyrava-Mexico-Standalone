export type RecommendationLike = Record<string, unknown>;

const FILING_OR_REMEDY_RX =
  /\b(?:presentar|interponer|promover|formular|iniciar|preparar|redactar|solicitar|tramitar)\b[^.!?\n]{0,110}\b(?:demanda|amparo|recurso|apelacion|apelación|revision|revisión|queja|reclamacion|reclamación|juicio|incidente|medio de defensa|suspensi[oó]n|nulidad)\b|\b(?:demanda de amparo|amparo directo|amparo indirecto|recurso de revision|recurso de revisión|recurso de queja|recurso de reclamacion|recurso de reclamación|apelacion|apelación|suspensi[oó]n del acto reclamado|ampliaci[oó]n de demanda|petici[oó]n de nulidad)\b/i;

const CONCLUDED_PROSPECTIVE_ACTION_RX =
  /\b(?:presentar|interponer|promover|redactar|formular|tramitar|iniciar|solicitar|preparar)\b[^.!?\n]{0,120}\b(?:demanda(?:\s+de\s+amparo)?|amparo\s+(?:directo|indirecto)|recurso(?:\s+de\s+(?:revisi[oó]n|queja|reclamaci[oó]n))?|apelaci[oó]n|suspensi[oó]n(?:\s+del\s+acto\s+reclamado)?|ampliaci[oó]n\s+de\s+demanda|petici[oó]n\s+de\s+nulidad|incidente)\b|\bmientras\s+se\s+resuelve\s+el\s+amparo\b|\b(?:demanda\s+de\s+amparo\s+(?:directo|indirecto)|suspensi[oó]n\s+del\s+acto\s+reclamado|ampliaci[oó]n\s+de\s+demanda|petici[oó]n\s+de\s+nulidad|recurso\s+de\s+revisi[oó]n\s+ante\s+el\s+tribunal\s+de\s+alzada)\b/i;

// A concluded case may still have a real post-judgment remedy, but a citation to
// the historic record is NOT enough to prove that remedy remains procedurally
// available. Require explicit posture language showing a genuinely subsequent
// event/remedy (compliance, execution, new act, supervening fact, etc.). This
// prevents an already-decided ADR from regenerating the very recurso/amparo or
// a notification incident that belongs to the historical proceeding.
const EXPLICIT_POST_JUDGMENT_REMEDY_RX =
  /\b(?:posterior(?:mente)?\s+a\s+la\s+sentencia|despu[eé]s\s+de\s+la\s+sentencia|post[- ]?sentencia|post[- ]?judgment|cumplimiento\s+de\s+(?:la\s+)?sentencia|ejecuci[oó]n\s+de\s+(?:la\s+)?sentencia|incidente\s+de\s+cumplimiento|nuevo\s+acto\s+de\s+autoridad|acto\s+nuevo|hecho\s+superveniente|resoluci[oó]n\s+posterior|nueva\s+resoluci[oó]n|recurso\s+contra\s+la\s+nueva\s+resoluci[oó]n|remedy\s+after\s+judgment|post[- ]?judgment\s+remedy|new\s+government\s+act|supervening\s+fact)\b/i;

const PINPOINT_RX = /\[?DOC\s+\d+\s+p\.\s*\d+\]?/i;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_FINDING_ID_RX = /^(?:finding|cf|canonical|f)[_:-][a-z0-9][a-z0-9_.:-]{4,}$/i;

function nonEmptyArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((item) => item != null && String(item).trim().length > 0) : [];
}

function isPlausibleFindingId(value: unknown): boolean {
  const s = String(value ?? "").trim();
  return UUID_RX.test(s) || CANONICAL_FINDING_ID_RX.test(s);
}

function hasPinpointEvidence(value: unknown): boolean {
  if (typeof value === "string") return PINPOINT_RX.test(value);
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const doc = Number(row.doc_n ?? row.doc ?? row.document_number);
  const page = Number(row.page ?? row.page_number);
  const quote = String(row.quote ?? row.excerpt ?? "").trim();
  return Number.isFinite(doc) && doc > 0 && Number.isFinite(page) && page > 0 && quote.length > 0;
}

function hasCanonicalFinding(rec: RecommendationLike): boolean {
  return nonEmptyArray(rec.supportingFindingIds).some(isPlausibleFindingId);
}

function allEvidence(rec: RecommendationLike): unknown[] {
  return [
    ...nonEmptyArray(rec.supportingEvidence),
    ...nonEmptyArray(rec.citations),
    ...nonEmptyArray(rec.factual_basis),
  ];
}

function recommendationText(rec: RecommendationLike): string {
  return [
    rec.title,
    rec.reason,
    rec.action,
    rec.motion,
    rec.expectedImpact,
    rec.procedural_posture,
    rec.case_status,
    rec.legal_rationale,
    rec.description,
  ]
    .map((v) => String(v ?? ""))
    .join(" ");
}

const INAPPROPRIATE_JUDICIAL_EVIDENCE_ADVICE_RX =
  /\b(?:certificaci[oó]n\s+notarial|cotejo\s+notarial|ratificaci[oó]n\s+ante\s+notario|acreditar\s+la\s+existencia\s+de\s+la\s+sentencia|corroboraci[oó]n\s+independiente\s+de\s+la\s+(?:resoluci[oó]n|sentencia|scjn|ejecutoria)|notarizar\s+la\s+resoluci[oó]n)\b/i;

export function isInappropriateJudicialEvidenceAdvice(text: unknown): boolean {
  return INAPPROPRIATE_JUDICIAL_EVIDENCE_ADVICE_RX.test(String(text ?? "").trim());
}

export function isLegalFilingRecommendation(text: unknown): boolean {
  return FILING_OR_REMEDY_RX.test(String(text ?? "").trim());
}

export function isConcludedCaseProspectiveAction(text: unknown): boolean {
  return CONCLUDED_PROSPECTIVE_ACTION_RX.test(String(text ?? "").trim());
}

/**
 * Attorney-facing filing/remedy advice has a higher evidentiary burden than
 * an ordinary investigation task. It must tie to BOTH a canonical finding
 * and pinpoint record evidence. A generated legal sentence, a workflow
 * dependency, or a quote with no finding linkage cannot authorize a filing.
 * This rule is intentionally mode-independent: the same trustworthy standard
 * applies to ongoing and concluded cases.
 */
export function hasStructuredRecommendationSupport(rec: RecommendationLike): boolean {
  return hasCanonicalFinding(rec) && allEvidence(rec).some(hasPinpointEvidence);
}

/**
 * For a CONCLUDED case, historic support for what happened in the old case is
 * not proof that a new filing remains available now. A prospective remedy is
 * allowed through only when BOTH ordinary structured support exists and the
 * recommendation itself identifies a genuine post-judgment posture/event.
 */
export function hasConcludedPostureSupport(rec: RecommendationLike): boolean {
  return hasStructuredRecommendationSupport(rec) && EXPLICIT_POST_JUDGMENT_REMEDY_RX.test(recommendationText(rec));
}

export function filterUnsupportedLegalFilingRecommendations<T extends RecommendationLike>(
  recommendations: readonly T[],
): { items: T[]; removed: T[] } {
  const items: T[] = [];
  const removed: T[] = [];
  for (const rec of recommendations) {
    const text = [rec.title, rec.reason, rec.action, rec.motion].map((v) => String(v ?? "")).join(" ");
    if (isInappropriateJudicialEvidenceAdvice(text)) {
      removed.push(rec);
      continue;
    }
    if (isLegalFilingRecommendation(text) && !hasStructuredRecommendationSupport(rec)) {
      removed.push(rec);
      continue;
    }
    items.push(rec);
  }
  return { items, removed };
}

export function filterConcludedCaseProspectiveRecommendations<T extends RecommendationLike>(
  recommendations: readonly T[],
): { items: T[]; removed: T[] } {
  const items: T[] = [];
  const removed: T[] = [];
  for (const rec of recommendations) {
    const text = recommendationText(rec);
    if (isInappropriateJudicialEvidenceAdvice(text)) {
      removed.push(rec);
      continue;
    }
    if (isConcludedCaseProspectiveAction(text) && !hasConcludedPostureSupport(rec)) {
      removed.push(rec);
      continue;
    }
    items.push(rec);
  }
  return { items, removed };
}

/**
 * Free narrative prose never owns a legal filing/remedy recommendation. If a
 * route is genuinely supported it belongs in canonical_recommendations, where
 * its structured finding/evidence support can be audited.
 */
export function scrubUnsupportedLegalFilingSentences(text: string): {
  text: string;
  removed: number;
} {
  if (!text.trim()) return { text, removed: 0 };
  const parts = text.split(/(?<=[.!?])\s+|\n+/g);
  const kept: string[] = [];
  let removed = 0;
  for (const part of parts) {
    const sentence = part.trim();
    if (!sentence) continue;
    if (isInappropriateJudicialEvidenceAdvice(sentence) || isLegalFilingRecommendation(sentence)) {
      removed += 1;
      continue;
    }
    kept.push(sentence);
  }
  return { text: kept.join(" ").replace(/\s+/g, " ").trim(), removed };
}

export function scrubConcludedCaseProspectiveSentences(text: string): {
  text: string;
  removed: number;
} {
  if (!text.trim()) return { text, removed: 0 };
  const parts = text.split(/(?<=[.!?])\s+|\n+/g);
  const kept: string[] = [];
  let removed = 0;
  for (const part of parts) {
    const sentence = part.trim();
    if (!sentence) continue;
    if (isConcludedCaseProspectiveAction(sentence)) {
      removed += 1;
      continue;
    }
    kept.push(sentence);
  }
  return { text: kept.join(" ").replace(/\s+/g, " ").trim(), removed };
}
