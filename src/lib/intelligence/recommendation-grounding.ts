export type RecommendationLike = Record<string, unknown>;

const FILING_OR_REMEDY_RX =
  /\b(?:presentar|interponer|promover|formular|iniciar|preparar)\b[^.!?\n]{0,90}\b(?:demanda|amparo|recurso|apelacion|apelación|revision|revisión|queja|reclamacion|reclamación|juicio|incidente|medio de defensa)\b|\b(?:demanda de amparo|amparo directo|amparo indirecto|recurso de revision|recurso de revisión|recurso de queja|recurso de reclamacion|recurso de reclamación|apelacion|apelación)\b/i;

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
 * A recommendation that asks an attorney to start/forward a legal proceeding
 * must carry structured support before it can enter the canonical action list.
 * The rule is materia/mode neutral: unsupported filing advice is unsafe in any
 * report.
 */
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

/**
 * Free narrative prose never owns a legal filing/remedy recommendation. If a
 * route is genuinely supported it belongs in canonical_recommendations, where
 * its structured finding/evidence support can be audited. Removing it here
 * also prevents the same action from surviving in an executive-summary
 * paragraph after the canonical action itself was correctly suppressed.
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
