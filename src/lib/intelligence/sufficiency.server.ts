// Evidence Sufficiency Scoring (ESS) + Narrative Caps + Secondary Validator.
//
// Implements the platform's "sparse evidence → sparse reports" rule. The
// pipeline must never generate a 20-page narrative from a 660-character
// corpus. ESS bins drive maximum per-section length, motion availability,
// and quantitative scoring availability. A secondary validator pass strips
// any sentence that cannot be traced back to the extracted corpus.

export type ESSInputs = {
  documentCount: number;
  pageCount: number;
  /** Total characters of extracted text across the corpus. */
  extractedChars: number;
  /** Distinct verified findings persisted for the case. */
  factCount: number;
  /** Count of validated contradictions (already gated). */
  contradictionCount: number;
  /** Count of facts corroborated by ≥2 source documents. */
  corroboratedCount: number;
  /**
   * OPTIONAL doc-type signals (recalibration override). When any of these
   * indicate a substantive litigation corpus — a charging document, a
   * high-weight document type (indictment, complaint, search warrant, expert
   * report, grand jury transcript, proffer), or ≥3 distinct document types —
   * the case is promoted to Full Analysis regardless of the raw corpus
   * metrics. This prevents the "Limited Analysis" label from firing on
   * concise but litigation-ready records.
   */
  hasChargingDocument?: boolean;
  highWeightDocTypeCount?: number;
  distinctDocTypeCount?: number;
};

export type ESSResult = {
  score: number; // 0..100
  bin: "minimal" | "low" | "medium" | "high";
  maxNarrativePages: number; // soft cap for each prose section
  maxCharsPerSection: number; // hard cap for each prose section
  allowQuantitativeScores: boolean;
  allowMotionGeneration: boolean;
  allowLegalTheories: boolean;
  insufficientEvidenceNotice: string | null;
  reasons: string[];
  /** True when the doc-type override promoted the case to Full Analysis. */
  fullAnalysisOverride?: boolean;
};

// ---------------------------------------------------------------------------
// Document-type classifier (heuristic, filename + text driven).
// Used by the pipeline to feed ESS the recalibration signals above. Keeping
// this here (not in the pipeline module) lets tests exercise it directly.
// ---------------------------------------------------------------------------

// TODO(i18n): every pattern below is English-only. A non-English filing will
// silently fail to match any of these and just look like a sparse/unweighted
// corpus (lower ESS bin) rather than surfacing "document language not
// recognized" as a distinct signal. Fixing this properly needs a language
// detection step, which is new capability and intentionally not added here.
const HIGH_WEIGHT_PATTERNS: Array<{ type: string; rx: RegExp }> = [
  { type: "indictment", rx: /\bindictment\b/i },
  { type: "complaint", rx: /\bcomplaint\b/i },
  { type: "search_warrant", rx: /\b(search\s+warrant|warrant\s+affidavit)\b/i },
  { type: "expert_report", rx: /\b(expert\s+(report|affidavit|opinion|declaration))\b/i },
  { type: "grand_jury_transcript", rx: /\bgrand\s+jury\b/i },
  { type: "proffer_agreement", rx: /\bproffer\b/i },
  // Mexican-Spanish equivalents. Without these, this classifier — built
  // entirely on English legal vocabulary — silently fails to recognize any
  // document in a Spanish-language corpus, which is every case this product
  // actually serves. A demanda, auto de vinculación, or dictamen pericial is
  // exactly as substantive as an English complaint or expert report, but
  // none of the English-only patterns above ever match it.
  { type: "indictment", rx: /\b(auto\s+de\s+(formal\s+prisi[oó]n|vinculaci[oó]n\s+a\s+proceso)|pliego\s+de\s+consignaci[oó]n)\b/i },
  { type: "complaint", rx: /\b(demanda|querella|denuncia)\b/i },
  { type: "search_warrant", rx: /\b(orden\s+de\s+(cateo|aprehensi[oó]n))\b/i },
  { type: "expert_report", rx: /\b(dictamen\s+pericial|peritaje)\b/i },
];

const CHARGING_DOC_PATTERNS: RegExp[] = [
  /\bindictment\b/i,
  /\bcomplaint\b/i,
  /\binformation\b/i,
  /\bcriminal\s+complaint\b/i,
  /\bfelony\s+complaint\b/i,
  /\bmisdemeanor\s+complaint\b/i,
  /\bcharging\s+document\b/i,
  // Mexican-Spanish equivalents — the initiating/foundational filing in a
  // Mexican matter (a civil/familiar demanda, a criminal querella/denuncia,
  // an amparo demanda, or the auto that opens a criminal proceeding).
  /\bdemanda\b/i,
  /\bquerella\b/i,
  /\bdenuncia\b/i,
  /\bauto\s+de\s+vinculaci[oó]n\s+a\s+proceso\b/i,
  /\bpliego\s+de\s+consignaci[oó]n\b/i,
];

const DOC_TYPE_PATTERNS: Array<{ type: string; rx: RegExp }> = [
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
  // Mexican-Spanish equivalents — see the note on HIGH_WEIGHT_PATTERNS above.
  // Same reasoning: every pattern above is English-only, so a wholly
  // Spanish-language corpus (the norm for this product) never accumulates
  // distinctDocTypeCount past 0, and the ">= 3 distinct types" override path
  // never fires either. These map the same concepts to their Mexican filing
  // names, not a 1:1 legal-system translation.
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
  // Common Mexican document types with no clean English analogue above.
  { type: "public_deed", rx: /\bescritura\s+p[uú]blica\b/i },
  { type: "property_registry", rx: /\b(registro\s+p[uú]blico\s+de\s+la\s+propiedad|libertad\s+de\s+grav[aá]men)\b/i },
  { type: "amparo_filing", rx: /\b(amparo|informe\s+justificado|acuerdo\s+de\s+suspensi[oó]n)\b/i },
];

export type DocTypeSignals = {
  hasChargingDocument: boolean;
  highWeightDocTypeCount: number;
  distinctDocTypeCount: number;
  highWeightTypes: string[];
  distinctTypes: string[];
};

export function detectDocTypeSignals(
  docs: Array<{ filename?: string | null; extracted_text?: string | null }>,
): DocTypeSignals {
  const highWeight = new Set<string>();
  const distinct = new Set<string>();
  let hasCharging = false;
  for (const d of docs) {
    const name = String(d.filename ?? "");
    // Sample the head of the extracted text — charging docs / captions live
    // in the first page. Avoids scanning megabytes for every doc.
    const head = String(d.extracted_text ?? "").slice(0, 4000);
    // Mexican filenames are conventionally underscore- or hyphen-separated
    // (e.g. "01_Demanda_Divorcio.txt"), but regex \b treats underscore as a
    // word character, so \bdemanda\b would never match "_Demanda_" as-is.
    // Normalizing separators to spaces lets filename matching work the same
    // as body-text matching.
    const normalizedName = name.replace(/[_-]+/g, " ");
    const hay = `${normalizedName}\n${head}`;
    for (const p of HIGH_WEIGHT_PATTERNS) if (p.rx.test(hay)) highWeight.add(p.type);
    for (const p of DOC_TYPE_PATTERNS) if (p.rx.test(hay)) distinct.add(p.type);
    if (!hasCharging) hasCharging = CHARGING_DOC_PATTERNS.some((rx) => rx.test(hay));
  }
  return {
    hasChargingDocument: hasCharging,
    highWeightDocTypeCount: highWeight.size,
    distinctDocTypeCount: distinct.size,
    highWeightTypes: [...highWeight],
    distinctTypes: [...distinct],
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
  } = inputs;
  const reasons: string[] = [];

  // Saturating component scores (each 0..1).
  const sDocs = Math.min(1, documentCount / 8);
  const sChars = Math.min(1, extractedChars / 50_000);
  const sFacts = Math.min(1, factCount / 25);
  const sCorrob = Math.min(1, corroboratedCount / 6);
  const sConflict = Math.min(1, contradictionCount / 4);

  // Weighted blend — corpus mass + extracted facts dominate.
  //
  // TODO(calibration): these weights (0.20/0.30/0.30/0.15/0.05) and the bin
  // thresholds below (1,000 / 20,000 / 50,000 chars; 3 / 8 / 20 facts) are
  // hand-picked, not derived from real attorney/outcome data. This function
  // tells attorneys below-threshold reports "would not be defensible" (see
  // insufficientEvidenceNotice below) — a claim now softened to reflect that
  // it's this platform's current bar, not an empirically validated one.
  // Properly calibrating requires logging (ESS score + bin) alongside
  // whether the resulting report held up in practice, which is new
  // infrastructure and intentionally not added here.
  const raw = sDocs * 0.2 + sChars * 0.3 + sFacts * 0.3 + sCorrob * 0.15 + sConflict * 0.05;
  const score = Math.round(raw * 100);

  // Bin selection follows the spec's narrative-length thresholds.
  let bin: ESSResult["bin"];
  let maxNarrativePages: number;
  let maxCharsPerSection: number;
  // A short appellate brief or pleading can still contain many verified facts.
  // Do not force the whole report into "minimal" solely because the source is
  // concise; use minimal only when both the corpus and verified-fact set are
  // sparse. This preserves hallucination controls without suppressing complete
  // PDFs for compact but analyzable records.
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

  // ------------------------------------------------------------------
  // Full-Analysis override.
  // A case with a charging document, any high-weight document type, or
  // ≥3 distinct document types is a substantive litigation corpus and
  // qualifies for Full Analysis even if character/fact counts are low.
  // Lifts the bin to at least "medium", enables scoring/motions/theories,
  // and suppresses the "minimal" insufficiency notice so downstream
  // labelling renders "Full Case Analysis".
  // ------------------------------------------------------------------
  const overrideTriggered = hasChargingDocument || highWeightDocTypeCount > 0 || distinctDocTypeCount >= 3;

  if (overrideTriggered && (bin === "minimal" || bin === "low")) {
    bin = "medium";
    maxNarrativePages = Math.max(maxNarrativePages, 10);
    maxCharsPerSection = Math.max(maxCharsPerSection, 7_000);
    reasons.push(
      `Full Analysis override: hasChargingDocument=${hasChargingDocument}, highWeightDocTypes=${highWeightDocTypeCount}, distinctDocTypes=${distinctDocTypeCount}.`,
    );
  }

  const allowQuantitativeScores = overrideTriggered ? true : bin !== "minimal" && factCount >= 5;
  const allowMotionGeneration = overrideTriggered ? true : bin !== "minimal" && factCount >= 4;
  const allowLegalTheories = overrideTriggered ? true : bin !== "minimal";

  const insufficientEvidenceNotice =
    !overrideTriggered && bin === "minimal"
      ? "Insufficient evidence for full legal intelligence. This report is limited to verified facts and missing-evidence notices. Generating theories, motions, or quantitative scores from this corpus does not meet this platform's current bar for full analysis."
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

// ---------------------------------------------------------------------------
// Secondary validator — sentence-level corpus traceability.
// Drops any sentence whose 4+ longest word tokens do not appear in the
// extracted corpus. Pure-text utility, no LLM cost.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the",
  "and",
  "that",
  "this",
  "with",
  "from",
  "into",
  "have",
  "been",
  "were",
  "they",
  "their",
  "there",
  "which",
  "while",
  "because",
  "about",
  "these",
  "those",
  "other",
  "shall",
  "will",
  "would",
  "could",
  "should",
  "under",
  "upon",
  "such",
  "than",
  "then",
  "when",
  "where",
  "what",
  "whom",
  "whose",
  "also",
  "each",
  "more",
  "most",
  "some",
  "only",
  "very",
  "much",
  "many",
  "over",
  "case",
  "court",
  "party",
  "parties",
  "matter",
  "filed",
  "based",
  "being",
  "cannot",
  "does",
  "done",
  "made",
  "make",
  "made",
  "said",
  "according",
  "including",
  "without",
  "within",
  "between",
  "among",
  "through",
]);

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z'\-]{3,}/g) ?? []).filter((t) => !STOPWORDS.has(t));
}

function buildCorpusVocab(corpusText: string): Set<string> {
  return new Set(tokens(corpusText));
}

function sentenceTraceable(sentence: string, vocab: Set<string>): boolean {
  const toks = tokens(sentence);
  // Truly empty (punctuation-only, stray markers) — nothing to check.
  if (toks.length === 0) return true;
  if (toks.length < 4) {
    // A heading or structural fragment ("Statement of Facts", "Argument")
    // never ends in sentence-ending punctuation and was never a factual
    // claim to begin with — the original exemption was really meant for
    // these, and they should stay exempt. A short *declarative* sentence
    // ending in ".", "!", or "?" — e.g. "He lied." — IS a factual claim
    // and previously slipped through ungated at any length under 4 tokens
    // purely because it was short. Only the latter needs the stricter check.
    const looksLikeSentence = /[.!?]\s*$/.test(sentence.trim());
    if (!looksLikeSentence) return true; // heading/transition — exempt
    const hits = toks.filter((t) => vocab.has(t)).length;
    return hits === toks.length; // short factual claims: require full coverage
  }
  const hits = toks.filter((t) => vocab.has(t)).length;
  // At least 35% of meaningful tokens must appear in the corpus.
  return hits / toks.length >= 0.35;
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z(•\-"])/g;

// Common abbreviations/initials that end in a period but are NOT sentence
// boundaries. Shared by both the corpus-traceability validator below and
// capNarrative() further down — a naive sentence-boundary check treats
// every one of these as a real sentence end, which routinely splits or
// truncates text mid-sentence right after a name like "Officer T. Alvarez"
// or a legal abbreviation like "Av. Rev. Stat.", "St.", "Ave.", "No.".
// This applies across every case, not any single corpus.
const NON_SENTENCE_ABBREVIATIONS =
  /\b(?:[A-Z]|Mr|Mrs|Ms|Dr|Rev|St|Ave|Rd|Blvd|No|Stat|Inc|Corp|Co|Ltd|Jr|Sr|vs|v|etc|al|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.\s$/i;

/**
 * Splits `body` into sentences, then re-merges any adjacent fragments where
 * the split point was actually an abbreviation/initial (e.g. "T. Alvarez",
 * "Av. Rev. Stat.") rather than a real sentence end. Without this, a
 * fragment like "Alvarez stopped..." can independently fail the corpus
 * traceability check and be silently dropped, deleting real content from
 * the report — the same root cause as the capNarrative truncation bug
 * above, just manifesting as missing text instead of a broken sentence.
 */
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

  // Preserve paragraph and list structure — validate sentence-by-sentence
  // within each line, keep bullet markers.
  const lines = text.split(/\r?\n/);
  let kept = 0,
    dropped = 0;
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
      } else dropped += 1;
    }
    if (surviving.length === 0) continue;
    outLines.push(bullet + surviving.join(" "));
  }
  return {
    text: outLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    kept,
    dropped,
  };
}

// ---------------------------------------------------------------------------
// Narrative length cap. Truncates at the nearest REAL sentence boundary and
// appends an explicit notice rather than silently chopping.
// ---------------------------------------------------------------------------

/**
 * Finds the last index in `text` that is a genuine sentence-ending period,
 * skipping any "period + space" that's actually an abbreviation or
 * single-letter initial (e.g. "T. Alvarez", "Av. Rev. Stat.").
 */
function lastRealSentenceBoundary(text: string): number {
  let searchFrom = text.length;
  while (searchFrom > 0) {
    const idx = text.lastIndexOf(". ", searchFrom - 1);
    if (idx === -1) return -1;
    const precedingContext = text.slice(Math.max(0, idx - 12), idx + 2);
    if (!NON_SENTENCE_ABBREVIATIONS.test(precedingContext)) {
      return idx;
    }
    searchFrom = idx; // keep looking further back for a real boundary
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
