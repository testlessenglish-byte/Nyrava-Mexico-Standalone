export type RecommendationLike = Record<string, unknown>;

const FILING_OR_REMEDY_RX =
  /\b(?:presentar|interponer|promover|formular|iniciar|preparar|redactar|solicitar|tramitar)\b[^.!?\n]{0,110}\b(?:demanda|amparo|recurso|apelacion|apelación|revision|revisión|queja|reclamacion|reclamación|juicio|incidente|medio de defensa|suspensi[oó]n|nulidad)\b|\b(?:demanda de amparo|amparo directo|amparo indirecto|recurso de revision|recurso de revisión|recurso de queja|recurso de reclamacion|recurso de reclamación|apelacion|apelación|suspensi[oó]n del acto reclamado|ampliaci[oó]n de demanda|petici[oó]n de nulidad)\b/i;

/**
 * Forward-looking acts that are especially unsafe in a retrospective audit
 * unless the record establishes a still-available post-judgment route.
 * These patterns intentionally describe PROCEDURAL ACTS, not mere discussion
 * of them: a report may explain that a suspension or appeal existed without
 * recommending that the attorney file one now.
 */
const CONCLUDED_PROSPECTIVE_ACTION_RX =
  /\b(?:presentar|interponer|promover|redactar|formular|tramitar|iniciar|solicitar|preparar)\b[^.!?\n]{0,120}\b(?:demanda(?:\s+de\s+amparo)?|amparo\s+(?:directo|indirecto)|recurso(?:\s+de\s+(?:revisi[oó]n|queja|reclamaci[oó]n))?|apelaci[oó]n|suspensi[oó]n(?:\s+del\s+acto\s+reclamado)?|ampliaci[oó]n\s+de\s+demanda|petici[oó]n\s+de\s+nulidad|incidente)\b|\bmientras\s+se\s+resuelve\s+el\s+amparo\b|\b(?:demanda\s+de\s+amparo\s+(?:directo|indirecto)|suspensi[oó]n\s+del\s+acto\s+reclamado|ampliaci[oó]n\s+de\s+demanda|petici[oó]n\s+de\s+nulidad|recurso\s+de\s+revisi[oó]n\s+ante\s+el\s+tribunal\s+de\s+alzada)\b/i;

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

export function isLegalFilingRecommendation(text: unknown): boolean {
  return FILING_OR_REMEDY_RX.test(String(text ?? "").trim());
}

export function isConcludedCaseProspectiveAction(text: unknown): boolean {
  return CONCLUDED_PROSPECTIVE_ACTION_RX.test(String(text ?? "").trim());
}

/**
 * Filing/remedy advice needs auditable support, not merely another generated
 * string. Workflow dependencies and uncited factual-basis prose are NOT
 * evidence. Accept only a real canonical-finding identifier or pinpoint
 * document support that contains a concrete DOC/page reference (or a
 * structured citation with doc, page and quote).
 */
export function hasStructuredRecommendationSupport(rec: RecommendationLike): boolean {
  const findingIds = nonEmptyArray(rec.supportingFindingIds);
  if (findingIds.some(isPlausibleFindingId)) return true;

  const evidence = nonEmptyArray(rec.supportingEvidence);
  if (evidence.some(hasPinpointEvidence)) return true;

  const citations = nonEmptyArray(rec.citations);
  if (citations.some(hasPinpointEvidence)) return true;

  const factualBasis = nonEmptyArray(rec.factual_basis);
  if (factualBasis.some(hasPinpointEvidence)) return true;

  return false;
}

/**
 * For a concluded case, a generic citation showing that the court discussed a
 * doctrine is NOT enough to establish that a new proceeding remains legally
 * available. Require both a canonical finding and pinpoint record support for
 * a prospective procedural act. This deliberately leaves non-procedural audit
 * actions (verify resolutivos, obtain the complete expediente, research a
 * cited precedent) untouched.
 */
export function hasConcludedPostureSupport(rec: RecommendationLike): boolean {
  const findingIds = nonEmptyArray(rec.supportingFindingIds);
  const hasFinding = findingIds.some(isPlausibleFindingId);
  const evidence = [
    ...nonEmptyArray(rec.supportingEvidence),
    ...nonEmptyArray(rec.citations),
    ...nonEmptyArray(rec.factual_basis),
  ];
  return hasFinding && evidence.some(hasPinpointEvidence);
}

export function filterUnsupportedLegalFilingRecommendations<T extends RecommendationLike>(
  recommendations: readonly T[],
): { items: T[]; removed: T[] } {
  const items: T[] = [];
  const removed: T[] = [];
  for (const rec of recommendations) {
    const text = [rec.title, rec.reason, rec.action, rec.motion].map((v) => String(v ?? "")).join(" ");
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
    const text = [rec.title, rec.reason, rec.action, rec.motion, rec.expectedImpact]
      .map((v) => String(v ?? ""))
      .join(" ");
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
    if (isLegalFilingRecommendation(sentence)) {
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
