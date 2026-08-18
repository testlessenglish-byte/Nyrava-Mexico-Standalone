export type RecommendationLike = Record<string, unknown>;

const FILING_OR_REMEDY_RX =
  /\b(?:presentar|interponer|promover|formular|iniciar|preparar)\b[^.!?\n]{0,90}\b(?:demanda|amparo|recurso|apelacion|apelación|revision|revisión|queja|reclamacion|reclamación|juicio|incidente|medio de defensa)\b|\b(?:demanda de amparo|amparo directo|amparo indirecto|recurso de revision|recurso de revisión|recurso de queja|recurso de reclamacion|recurso de reclamación|apelacion|apelación)\b/i;

function nonEmptyArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((item) => item != null && String(item).trim().length > 0) : [];
}

/**
 * A recommendation that asks an attorney to START/FORWARD a legal proceeding
 * is materially different from ordinary file-review housekeeping. It must
 * carry structured support produced by the pipeline before it is allowed into
 * the canonical attorney action list. This rule is case-type and mode neutral:
 * unsupported filing advice is unsafe in an ongoing case and in a concluded
 * audit alike.
 */
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
 * Narrative prose is not a suitable place to invent a legal filing route. A
 * filing/remedy sentence is retained only when it includes an inline corpus
 * citation. This does not validate that citation here; the normal rendered
 * citation verifier still does that later. It merely prevents unsupported
 * free-text legal filing advice from bypassing the structured gate above.
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
    if (isLegalFilingRecommendation(sentence) && !/\[DOC\s+\d+(?:\s+p\.\s*\d+)?\]/i.test(sentence)) {
      removed += 1;
      continue;
    }
    kept.push(sentence);
  }
  return { text: kept.join(" ").replace(/\s+/g, " ").trim(), removed };
}
