const GAP_SIGNAL_RX =
  /\b(?:no\s+se\s+(?:presenta|identific[oó]|localiz[oó]|encontr[oó])|no\s+(?:obra|consta|hay))\b[^.!?\n]{0,45}\b(?:evidencia|constancia|documentaci[oó]n|registro|soporte)\b/i;
const STRONG_ABSENCE_RX =
  /\b(?:falta\s+de|ausencia\s+de|no\s+fue|no\s+se\s+(?:realiz[oó]|notific[oó]|present[oó]|cumpli[oó]|acredit[oó]))\b/i;

const STOP = new Set([
  "para", "por", "con", "del", "las", "los", "una", "uno", "unos", "unas", "que", "como", "sobre",
  "esta", "este", "esto", "dicha", "dicho", "evidencia", "constancia", "documentacion", "registro", "soporte",
  "presenta", "identifico", "localizo", "encontro", "obra", "consta", "hay", "corpus", "expediente",
]);

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function tokens(value: string): Set<string> {
  return new Set(
    fold(value)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 5 && !STOP.has(token)),
  );
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/g).map((s) => s.trim()).filter(Boolean);
}

/**
 * Extract topics that the model itself described only as "not found in the
 * available corpus". Those topics may be reported as evidence gaps, but they
 * cannot later be upgraded into affirmative facts that an event did not occur.
 */
export function evidenceGapTopics(text: string): Array<Set<string>> {
  return splitSentences(text)
    .filter((sentence) => GAP_SIGNAL_RX.test(sentence))
    .map(tokens)
    .filter((set) => set.size > 0);
}

function overlapsGap(sentence: string, topics: Array<Set<string>>): boolean {
  const own = tokens(sentence);
  if (own.size === 0) return false;
  return topics.some((topic) => {
    let overlap = 0;
    for (const token of own) if (topic.has(token)) overlap += 1;
    return overlap >= 2 || (overlap >= 1 && Math.min(own.size, topic.size) <= 2);
  });
}

export function scrubEvidenceAbsenceInversion(
  text: string,
  topics: Array<Set<string>>,
): { text: string; removed: number } {
  if (!text.trim() || topics.length === 0) return { text, removed: 0 };
  const kept: string[] = [];
  let removed = 0;
  for (const sentence of splitSentences(text)) {
    // Neutral evidence-gap statements are allowed to remain. The problem is
    // the later conversion of that gap into "falta de X", "no fue X", etc.
    if (!GAP_SIGNAL_RX.test(sentence) && STRONG_ABSENCE_RX.test(sentence) && overlapsGap(sentence, topics)) {
      removed += 1;
      continue;
    }
    kept.push(sentence);
  }
  return { text: kept.join(" ").replace(/\s+/g, " ").trim(), removed };
}

export function isEvidenceGapStatement(text: string): boolean {
  return GAP_SIGNAL_RX.test(text);
}
