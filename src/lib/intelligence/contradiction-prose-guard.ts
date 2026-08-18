const CONTRADICTION_RX = /\bcontradicci[oó]n|contradictori[oa]s?\b/i;
const CONTRAST_RX = /\b(?:mientras\s+que|sin\s+embargo|en\s+cambio|por\s+el\s+contrario|frente\s+a|a\s+diferencia\s+de|pero)\b/i;
const SOURCE_RX = /\[DOC\s+\d+(?:\s+p\.\s*\d+)?\]/gi;

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/g).map((s) => s.trim()).filter(Boolean);
}

/**
 * A contradiction is relational: the prose must actually identify opposing
 * propositions, not merely attach the label "contradiction" to one holding.
 * Keep a contradiction sentence only when it contains an explicit contrast
 * marker or at least two distinct document citations. Structured
 * contradiction matrices remain the authoritative detailed representation.
 */
export function scrubUnsupportedContradictionSentences(text: string): {
  text: string;
  removed: number;
} {
  if (!text.trim()) return { text, removed: 0 };
  const kept: string[] = [];
  let removed = 0;
  for (const sentence of splitSentences(text)) {
    if (!CONTRADICTION_RX.test(sentence)) {
      kept.push(sentence);
      continue;
    }
    const citations = Array.from(sentence.matchAll(SOURCE_RX)).map((m) => m[0].toUpperCase());
    const distinctDocs = new Set(citations.map((c) => c.match(/DOC\s+(\d+)/)?.[1]).filter(Boolean));
    if (!CONTRAST_RX.test(sentence) && distinctDocs.size < 2) {
      removed += 1;
      continue;
    }
    kept.push(sentence);
  }
  return { text: kept.join(" ").replace(/\s+/g, " ").trim(), removed };
}
