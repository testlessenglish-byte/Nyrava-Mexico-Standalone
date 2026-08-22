// Evidence Sufficiency Scoring (ESS) + narrative caps + corpus validator.
// Pure deterministic utilities: no database and no model calls.

export type ESSInputs = {
  documentCount: number;
  pageCount: number;
  extractedChars: number;
  factCount: number;
  contradictionCount: number;
  corroboratedCount: number;
  hasChargingDocument?: boolean;
  highWeightDocTypeCount?: number;
  distinctDocTypeCount?: number;
  locale?: "en" | "es";
  /** True when the corpus contains a public draft/fragment but no complete judgment. */
  hasOnlyIncompleteJudicialPublication?: boolean;
};

export type ESSResult = {
  score: number;
  bin: "minimal" | "low" | "medium" | "high";
  maxNarrativePages: number;
  maxCharsPerSection: number;
  allowQuantitativeScores: boolean;
  allowMotionGeneration: boolean;
  allowLegalTheories: boolean;
  insufficientEvidenceNotice: string | null;
  reasons: string[];
  fullAnalysisOverride?: boolean;
};

type DocPattern = { type: string; rx: RegExp };

/**
 * High-weight documents are substantive records that can independently carry
 * enough legal/factual content for a useful analysis even when the corpus is
 * only one or two files. A final appellate/SCJN judgment belongs here just as
 * much as a complaint, warrant or expert report. Without this, a complete
 * ADR judgment could be mislabeled as a thin active-case file merely because
 * it is one document.
 */
const HIGH_WEIGHT_PATTERNS: DocPattern[] = [
  { type: "indictment", rx: /\bindictment\b/i },
  { type: "complaint", rx: /\bcomplaint\b/i },
  { type: "search_warrant", rx: /\b(search\s+warrant|warrant\s+affidavit)\b/i },
  { type: "expert_report", rx: /\b(expert\s+(report|affidavit|opinion|declaration))\b/i },
  { type: "grand_jury_transcript", rx: /\bgrand\s+jury\b/i },
  { type: "proffer_agreement", rx: /\bproffer\b/i },
  {
    type: "final_judgment",
    rx: /\b(final\s+judg(?:e)?ment|appellate\s+(?:opinion|decision)|supreme\s+court\s+(?:opinion|decision))\b/i,
  },
  {
    type: "indictment",
    rx: /\b(auto\s+de\s+(formal\s+prisi[oó]n|vinculaci[oó]n\s+a\s+proceso)|pliego\s+de\s+consignaci[oó]n)\b/i,
  },
  { type: "complaint", rx: /\b(demanda|querella|denuncia)\b/i },
  { type: "search_warrant", rx: /\b(orden\s+de\s+(cateo|aprehensi[oó]n))\b/i },
  { type: "expert_report", rx: /\b(dictamen\s+pericial|peritaje)\b/i },
  {
    type: "final_judgment",
    rx: /\b(sentencia\s+(?:definitiva|ejecutoria)|amparo\s+directo\s+en\s+revisi[oó]n|engrose|puntos?\s+resolutivos?)\b/i,
  },
];

// SCJN public-list documents often identify themselves as a fragment of a
// proyecto and expressly publish only one analytical section. A caption such
// as "amparo directo en revisión" does not turn that fragment into the signed
// engrose or a complete judgment.
export const INCOMPLETE_JUDICIAL_PUBLICATION_RE =
  /\b(fragmento\s+del\s+proyecto|versi[oó]n\s+p[uú]blica\s+parcial|[uú]nicamente\s+se\s+publica|s[oó]lo\s+se\s+publica|se\s+publica\s+(?:exclusivamente|[uú]nicamente)\s+el\s+(?:estudio|an[aá]lisis))\b/i;

const CHARGING_DOC_PATTERNS: RegExp[] = [
  /\bindictment\b/i,
  /\bcomplaint\b/i,
  /\binformation\b/i,
  /\bcriminal\s+complaint\b/i,
  /\bfelony\s+complaint\b/i,
  /\bmisdemeanor\s+complaint\b/i,
  /\bcharging\s+document\b/i,
  /\bdemanda\b/i,
  /\bquerella\b/i,
  /\bdenuncia\b/i,
  /\bauto\s+de\s+vinculaci[oó]n\s+a\s+proceso\b/i,
  /\bpliego\s+de\s+consignaci[oó]n\b/i,
];

const DOC_TYPE_PATTERNS: DocPattern[] = [
  { type: "indictment", rx: /\bindictment\b/i },
  { type: "complaint", rx: /\bcomplaint\b/i },
  { type: "answer", rx: /\banswer\b/i },
  { type: "motion", rx: /\bmotion\b/i },
  { type: "brief", rx: /\bbrief\b/i },
  { type: "warrant", rx: /\bwarrant\b/i },
  { type: "transcript", rx: /\btranscript\b/i },
  { type: "report", rx: /\breport\b/i },
  { type: "affidavit", rx: /\baffidavit\b/i },
  { type: "declaration", rx: /\bdeclaration\b/i },
  { type: "statement", rx: /\bstatement\b/i },
  { type: "deposition", rx: /\bdeposition\b/i },
  { type: "contract", rx: /\bcontract\b/i },
  { type: "agreement", rx: /\bagreement\b/i },
  { type: "petition", rx: /\bpetition\b/i },
  { type: "email", rx: /\bemail\b/i },
  { type: "invoice", rx: /\binvoice\b/i },
  { type: "medical", rx: /\b(medical|ER|hospital|admission|autopsy)\b/i },
  { type: "police_record", rx: /\b(arrest|police|body[\s_-]*cam|incident)\b/i },
  { type: "financial", rx: /\b(bank|ledger|payment|financial|payroll)\b/i },
  { type: "judgment", rx: /\b(final\s+judg(?:e)?ment|appellate\s+(?:opinion|decision))\b/i },
  { type: "indictment", rx: /\bauto\s+de\s+(formal\s+prisi[oó]n|vinculaci[oó]n\s+a\s+proceso)\b/i },
  { type: "complaint", rx: /\b(demanda|querella|denuncia)\b/i },
  { type: "answer", rx: /\bcontestaci[oó]n(\s+de\s+demanda)?\b/i },
  { type: "motion", rx: /\b(promoci[oó]n|escrito\s+de\s+cuenta)\b/i },
  { type: "brief", rx: /\balegatos\b/i },
  { type: "warrant", rx: /\borden\s+de\s+(cateo|aprehensi[oó]n)\b/i },
  { type: "transcript", rx: /\b(acta\s+(circunstanciada|de\s+audiencia)|diligencia)\b/i },
  { type: "report", rx: /\b(informe|dictamen|reporte|peritaje)\b/i },
  { type: "affidavit", rx: /\bdeclaraci[oó]n\s+jurada\b/i },
  { type: "declaration", rx: /\bdeclaraci[oó]n\b/i },
  { type: "statement", rx: /\bmanifestaci[oó]n\b/i },
  { type: "deposition", rx: /\btestimonial\b/i },
  { type: "contract", rx: /\bcontrato\b/i },
  { type: "agreement", rx: /\b(convenio|acuerdo)\b/i },
  { type: "petition", rx: /\bsolicitud\b/i },
  { type: "email", rx: /\bcorreo(\s+electr[oó]nico)?\b/i },
  { type: "invoice", rx: /\bfactura\b/i },
  { type: "medical", rx: /\b(m[eé]dico|hospital|cl[ií]nica|autopsia)\b/i },
  { type: "police_record", rx: /\b(detenci[oó]n|polic[ií]a|parte\s+informativo)\b/i },
  { type: "financial", rx: /\b(banco|estado\s+de\s+cuenta|pago|n[oó]mina)\b/i },
  { type: "public_deed", rx: /\bescritura\s+p[uú]blica\b/i },
  {
    type: "property_registry",
    rx: /\b(registro\s+p[uú]blico\s+de\s+la\s+propiedad|libertad\s+de\s+grav[aá]men)\b/i,
  },
  { type: "amparo_filing", rx: /\b(amparo|informe\s+justificado|acuerdo\s+de\s+suspensi[oó]n)\b/i },
  {
    type: "judgment",
    rx: /\b(sentencia\s+(?:definitiva|ejecutoria)|amparo\s+directo\s+en\s+revisi[oó]n|engrose|puntos?\s+resolutivos?)\b/i,
  },
];

export type DocTypeSignals = {
  hasChargingDocument: boolean;
  highWeightDocTypeCount: number;
  distinctDocTypeCount: number;
  highWeightTypes: string[];
  distinctTypes: string[];
  hasOnlyIncompleteJudicialPublication: boolean;
};

export function detectDocTypeSignals(
  docs: Array<{ filename?: string | null; extracted_text?: string | null }>,
): DocTypeSignals {
  const highWeight = new Set<string>();
  const distinct = new Set<string>();
  let hasCharging = false;
  let sawIncompleteJudicialPublication = false;
  for (const d of docs) {
    const name = String(d.filename ?? "");
    const head = String(d.extracted_text ?? "").slice(0, 4000);
    const normalizedName = name.replace(/[_-]+/g, " ");
    const hay = `${normalizedName}\n${head}`;
    const incompleteJudicialPublication = INCOMPLETE_JUDICIAL_PUBLICATION_RE.test(hay);
    if (incompleteJudicialPublication) sawIncompleteJudicialPublication = true;
    for (const p of HIGH_WEIGHT_PATTERNS) {
      if (p.type === "final_judgment" && incompleteJudicialPublication) continue;
      if (p.rx.test(hay)) highWeight.add(p.type);
    }
    for (const p of DOC_TYPE_PATTERNS) if (p.rx.test(hay)) distinct.add(p.type);
    if (!hasCharging) hasCharging = CHARGING_DOC_PATTERNS.some((rx) => rx.test(hay));
  }
  return {
    hasChargingDocument: hasCharging,
    highWeightDocTypeCount: highWeight.size,
    distinctDocTypeCount: distinct.size,
    highWeightTypes: [...highWeight],
    distinctTypes: [...distinct],
    hasOnlyIncompleteJudicialPublication:
      sawIncompleteJudicialPublication && !highWeight.has("final_judgment"),
  };
}

export function computeESS(inputs: ESSInputs): ESSResult {
  const {
    documentCount,
    extractedChars,
    factCount,
    contradictionCount,
    corroboratedCount,
    hasChargingDocument = false,
    highWeightDocTypeCount = 0,
    distinctDocTypeCount = 0,
    locale = "en",
    hasOnlyIncompleteJudicialPublication = false,
  } = inputs;
  const reasons: string[] = [];

  const sDocs = Math.min(1, documentCount / 8);
  const sChars = Math.min(1, extractedChars / 50_000);
  const sFacts = Math.min(1, factCount / 25);
  const sCorrob = Math.min(1, corroboratedCount / 6);
  const sConflict = Math.min(1, contradictionCount / 4);
  const raw = sDocs * 0.2 + sChars * 0.3 + sFacts * 0.3 + sCorrob * 0.15 + sConflict * 0.05;
  const score = Math.round(raw * 100);

  let bin: ESSResult["bin"];
  let maxNarrativePages: number;
  let maxCharsPerSection: number;
  if (extractedChars < 1_000 || factCount < 3) {
    bin = "minimal";
    maxNarrativePages = 2;
    maxCharsPerSection = 1_200;
    reasons.push(`Corpus is sparse (${extractedChars.toLocaleString()} chars, ${factCount} verified facts).`);
  } else if (extractedChars < 20_000 || factCount < 8) {
    bin = "low";
    maxNarrativePages = 5;
    maxCharsPerSection = 3_500;
  } else if (extractedChars < 50_000 || factCount < 20) {
    bin = "medium";
    maxNarrativePages = 10;
    maxCharsPerSection = 7_000;
  } else {
    bin = "high";
    maxNarrativePages = 25;
    maxCharsPerSection = 18_000;
  }

  const substantialCorpus = documentCount >= 15;
  const overrideTriggered =
    !hasOnlyIncompleteJudicialPublication &&
    (hasChargingDocument || highWeightDocTypeCount > 0 || distinctDocTypeCount >= 3 || substantialCorpus);

  if (overrideTriggered && (bin === "minimal" || bin === "low")) {
    bin = "medium";
    maxNarrativePages = Math.max(maxNarrativePages, 10);
    maxCharsPerSection = Math.max(maxCharsPerSection, 7_000);
    reasons.push(
      `Full Analysis override: hasChargingDocument=${hasChargingDocument}, highWeightDocTypes=${highWeightDocTypeCount}, distinctDocTypes=${distinctDocTypeCount}, documents=${documentCount}.`,
    );
  }

  const allowQuantitativeScores =
    !hasOnlyIncompleteJudicialPublication && (overrideTriggered ? true : bin !== "minimal" && factCount >= 5);
  const allowMotionGeneration =
    !hasOnlyIncompleteJudicialPublication && (overrideTriggered ? true : bin !== "minimal" && factCount >= 4);
  const allowLegalTheories =
    !hasOnlyIncompleteJudicialPublication && (overrideTriggered ? true : bin !== "minimal");
  const insufficientEvidenceNotice =
    hasOnlyIncompleteJudicialPublication
      ? locale === "es"
        ? "El documento judicial disponible es un fragmento o proyecto público, no la sentencia completa. El análisis se limita al contenido efectivamente publicado; se suprimen puntuaciones, teorías, promociones y conclusiones sobre puntos resolutivos hasta aportar el engrose o resolución íntegra."
        : "The available judicial document is a public fragment or draft, not the complete judgment. Analysis is limited to the published content; scores, theories, motions, and dispositive conclusions are suppressed until the complete signed decision is supplied."
      : !overrideTriggered && bin === "minimal"
      ? locale === "es"
        ? "Evidencia insuficiente para un análisis legal completo. Este reporte se limita a hechos verificados y avisos de evidencia faltante. Generar teorías, promociones o puntuaciones cuantitativas a partir de este acervo no cumple con el estándar actual de la plataforma para un análisis completo."
        : "Insufficient evidence for full legal intelligence. This report is limited to verified facts and missing-evidence notices. Generating theories, motions, or quantitative scores from this corpus does not meet this platform's current bar for full analysis."
      : null;

  return {
    score,
    bin,
    maxNarrativePages,
    maxCharsPerSection,
    allowQuantitativeScores,
    allowMotionGeneration,
    allowLegalTheories,
    insufficientEvidenceNotice,
    reasons,
    fullAnalysisOverride: overrideTriggered,
  };
}

export function computeWorkProductEss(
  docRows: Array<{ extracted_text?: string | null; filename?: string | null }>,
  findings: Array<{ source_doc_ids?: string[] }>,
): ESSResult {
  const extractedChars = docRows.reduce((n, d) => n + (d.extracted_text?.length ?? 0), 0);
  const corroboratedCount = findings.reduce((n, f) => {
    const ids = Array.isArray(f.source_doc_ids) ? f.source_doc_ids : [];
    return n + (new Set(ids).size >= 2 ? 1 : 0);
  }, 0);
  const docTypeSignals = detectDocTypeSignals(docRows);
  return computeESS({
    documentCount: docRows.length,
    pageCount: 0,
    extractedChars,
    factCount: findings.length,
    contradictionCount: 0,
    corroboratedCount,
    hasChargingDocument: docTypeSignals.hasChargingDocument,
    highWeightDocTypeCount: docTypeSignals.highWeightDocTypeCount,
    distinctDocTypeCount: docTypeSignals.distinctDocTypeCount,
    hasOnlyIncompleteJudicialPublication: docTypeSignals.hasOnlyIncompleteJudicialPublication,
  });
}

const STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "from", "into", "have", "been", "were", "they",
  "their", "there", "which", "while", "because", "about", "these", "those", "other", "shall",
  "will", "would", "could", "should", "under", "upon", "such", "than", "then", "when", "where",
  "what", "whom", "whose", "also", "each", "more", "most", "some", "only", "very", "much",
  "many", "over", "case", "court", "party", "parties", "matter", "filed", "based", "being",
  "cannot", "does", "done", "made", "make", "said", "according", "including", "without", "within",
  "between", "among", "through", "que", "para", "con", "los", "las", "del", "por", "una", "uno",
  "unos", "unas", "como", "pero", "este", "esta", "estos", "estas", "esos", "esas", "sobre",
  "entre", "desde", "hasta", "cuando", "donde", "cual", "cuales", "quien", "quienes", "sido",
  "fueron", "sera", "seran", "puede", "pueden", "debe", "deben", "tiene", "tienen", "segun",
  "dicho", "dicha", "dichos", "dichas", "mismo", "misma", "mismos", "mismas", "caso", "parte",
  "partes", "asunto",
]);

const WORD_CHAR = "a-záéíóúñüàèìòù";

function tokens(s: string): string[] {
  const rx = new RegExp(`[${WORD_CHAR}][${WORD_CHAR}'\\-]{3,}`, "g");
  return (s.toLowerCase().match(rx) ?? []).filter((t) => !STOPWORDS.has(t));
}

function buildCorpusVocab(corpusText: string): Set<string> {
  return new Set(tokens(corpusText));
}

function sentenceTraceable(sentence: string, vocab: Set<string>): boolean {
  const toks = tokens(sentence);
  if (toks.length === 0) return true;
  if (toks.length < 4) {
    const looksLikeSentence = /[.!?]\s*$/.test(sentence.trim());
    if (!looksLikeSentence) return true;
    const hits = toks.filter((t) => vocab.has(t)).length;
    return hits === toks.length;
  }
  const hits = toks.filter((t) => vocab.has(t)).length;
  return hits / toks.length >= 0.35;
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z(•\-"])/g;
const NON_SENTENCE_ABBREVIATIONS =
  /\b(?:[A-Z]|Mr|Mrs|Ms|Dr|Rev|St|Ave|Rd|Blvd|No|Stat|Inc|Corp|Co|Ltd|Jr|Sr|vs|v|etc|al|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.\s$/i;

function splitIntoRealSentences(body: string): string[] {
  const rawParts = body.split(SENTENCE_SPLIT);
  const merged: string[] = [];
  for (const part of rawParts) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && NON_SENTENCE_ABBREVIATIONS.test(prev.slice(-14) + " ")) {
      merged[merged.length - 1] = prev + " " + part;
    } else {
      merged.push(part);
    }
  }
  return merged;
}

export function validateProseAgainstCorpus(
  text: string,
  corpusText: string,
): { text: string; kept: number; dropped: number } {
  if (!text || !text.trim()) return { text, kept: 0, dropped: 0 };
  const vocab = buildCorpusVocab(corpusText);
  if (vocab.size === 0) return { text, kept: 0, dropped: 0 };

  const lines = text.split(/\r?\n/);
  let kept = 0;
  let dropped = 0;
  const outLines: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      outLines.push("");
      continue;
    }
    const bullet = line.match(/^(\s*(?:[-*•]|\d+\.)\s+)/)?.[1] ?? "";
    const body = line.slice(bullet.length);
    if (body.length < 12) {
      outLines.push(line);
      continue;
    }
    const sentences = splitIntoRealSentences(body);
    const surviving: string[] = [];
    for (const s of sentences) {
      if (sentenceTraceable(s, vocab)) {
        surviving.push(s);
        kept += 1;
      } else {
        dropped += 1;
      }
    }
    if (surviving.length === 0) continue;
    outLines.push(bullet + surviving.join(" "));
  }
  return {
    text: outLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    kept,
    dropped,
  };
}

function lastRealSentenceBoundary(text: string): number {
  let searchFrom = text.length;
  while (searchFrom > 0) {
    const idx = text.lastIndexOf(". ", searchFrom - 1);
    if (idx === -1) return -1;
    const precedingContext = text.slice(Math.max(0, idx - 12), idx + 2);
    if (!NON_SENTENCE_ABBREVIATIONS.test(precedingContext)) return idx;
    searchFrom = idx;
  }
  return -1;
}

export function capNarrative(
  text: string,
  maxChars: number,
  notice = "Additional analysis requires supplemental documents. See Evidence Coverage for gaps.",
): string {
  if (!text || text.length <= maxChars) return text ?? "";
  const slice = text.slice(0, maxChars);
  const sentenceCut = lastRealSentenceBoundary(slice);
  const cut = Math.max(sentenceCut, slice.lastIndexOf("\n"));
  const safe = cut > maxChars * 0.5 ? slice.slice(0, cut + 1) : slice;
  return `${safe.trim()}\n\n_${notice}_`;
}
