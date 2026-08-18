export type RecommendationLike = Record<string, unknown>;

const FILING_OR_REMEDY_RX =
  /\b(?:presentar|interponer|promover|formular|iniciar|preparar)\b[^.!?\n]{0,90}\b(?:demanda|amparo|recurso|apelacion|apelación|revision|revisión|queja|reclamacion|reclamación|juicio|incidente|medio de defensa)\b|\b(?:demanda de amparo|amparo directo|amparo indirecto|recurso de revision|recurso de revisión|recurso de queja|recurso de reclamacion|recurso de reclamación|apelacion|apelación)\b/i;

function nonEmptyArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((item) => item != null && String(item).trim().length > 0) : [];
}

export function isLegalFilingRecommendation(text: unknown): boolean {
  return FILING_OR_REMEDY_RX.test(String(text ?? "").trim());
}

export function hasStructuredRecommendationSupport(rec: RecommendationLike): boolean {
  return (
    nonEmptyArray(rec.supportingFindingIds).length > 0 ||
    nonEmptyArray(rec.supportingEvidence).length > 0 ||
    nonEmptyArray(rec.citations).length > 0 ||
    nonEmptyArray(rec.factual_basis).length > 0 ||
    nonEmptyArray(rec.depends_on).length > 0
  );
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
