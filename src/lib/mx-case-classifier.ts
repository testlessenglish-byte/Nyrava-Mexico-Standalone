// =============================================================================
// Clasificador de materia (Mexican practice-area classifier).
//
// Deterministic, keyword-weighted classifier over Mexican legal vocabulary.
// Used when a case is created without an explicit case_type (e.g. seeded test
// cases): the platform decides the materia itself instead of asking the user.
//
// Pure module — no IO, no AI call, fully unit-testable.
// =============================================================================

export type MxCaseType =
  | "penal"
  | "familiar"
  | "civil"
  | "mercantil"
  | "laboral"
  | "amparo"
  | "administrativo"
  | "fiscal"
  | "constitucional"
  | "inmobiliario";

export interface MxClassification {
  caseType: MxCaseType;
  /** 0..1 — share of total signal weight captured by the winning materia. */
  confidence: number;
  /** Terms that drove the decision, in match order. */
  matched: string[];
  /** Score per materia, for diagnostics. */
  scores: Record<string, number>;
}

/** Weighted signal terms per materia. Weight 3 = decisive, 1 = weak hint. */
const SIGNALS: Record<MxCaseType, Array<[RegExp, number]>> = {
  penal: [
    [/\bcarpeta de investigaci[oó]n\b/gi, 3],
    [/\bministerio p[uú]blico\b/gi, 3],
    [/\bimputad[oa]\b/gi, 3],
    [/\bvinculaci[oó]n a proceso\b/gi, 3],
    [/\bdato de prueba\b/gi, 2],
    [/\bcnpp\b|\bc[oó]digo nacional de procedimientos penales\b/gi, 3],
    [/\bdefensor[ií]a p[uú]blica\b/gi, 1],
    [/\bjuez de control\b/gi, 3],
    [/\bdelito\b|\bdelitos\b/gi, 2],
    [/\bv[ií]ctima u ofendido\b/gi, 2],
    [/\bprisi[oó]n preventiva\b/gi, 3],
    [/\basesor[ií]a jur[ií]dica de la v[ií]ctima\b/gi, 2],
  ],
  familiar: [
    [/\bjuicio de divorcio\b|\bdivorcio incausado\b|\bdivorcio\b/gi, 3],
    [/\bguarda y custodia\b/gi, 3],
    [/\bpensi[oó]n alimenticia\b|\balimentos\b/gi, 3],
    [/\bpatria potestad\b/gi, 3],
    [/\br[eé]gimen de convivencia\b|\bconvivencias\b/gi, 2],
    [/\bmenor(?:es)? de edad\b/gi, 1],
    [/\binter[eé]s superior (?:de la ni[nñ]ez|del menor)\b/gi, 3],
    [/\bviolencia familiar\b/gi, 2],
    [/\bjuez de lo familiar\b/gi, 3],
  ],
  civil: [
    [/\bc[oó]digo civil\b/gi, 3],
    [/\bda[nñ]o moral\b/gi, 3],
    [/\bresponsabilidad civil\b/gi, 3],
    [/\bincumplimiento de contrato\b/gi, 2],
    [/\bjuicio ordinario civil\b/gi, 3],
    [/\bprescripci[oó]n adquisitiva\b|\busucapi[oó]n\b/gi, 3],
    [/\barrendamiento\b|\bdesahucio\b/gi, 2],
    [/\breivindicatori[oa]\b/gi, 2],
    [/\bjuez de lo civil\b/gi, 2],
  ],
  mercantil: [
    [/\bc[oó]digo de comercio\b/gi, 3],
    [/\bjuicio ejecutivo mercantil\b/gi, 3],
    [/\bt[ií]tulo de cr[eé]dito\b|\bpagar[eé]\b|\bletra de cambio\b/gi, 3],
    [/\bsociedad an[oó]nima\b|\bs\.?a\.? de c\.?v\.?\b/gi, 2],
    [/\bconcurso mercantil\b/gi, 3],
    [/\bacta constitutiva\b/gi, 2],
    [/\bfactura(?:s)? comercial(?:es)?\b/gi, 1],
  ],
  laboral: [
    [/\bley federal del trabajo\b|\blft\b/gi, 3],
    [/\bdespido injustificado\b/gi, 3],
    [/\btribunal laboral\b|\bjunta de conciliaci[oó]n\b/gi, 3],
    [/\bindemnizaci[oó]n constitucional\b/gi, 3],
    [/\bfiniquito\b|\bliquidaci[oó]n\b/gi, 2],
    [/\bimss\b|\binfonavit\b/gi, 2],
    [/\bsalario diario integrado\b/gi, 3],
    [/\btrabajador(?:a)?\b|\bpatr[oó]n\b/gi, 1],
  ],
  amparo: [
    [/\bjuicio de amparo\b/gi, 3],
    [/\bamparo (?:indirecto|directo)\b/gi, 3],
    [/\bley de amparo\b/gi, 3],
    [/\bautoridad responsable\b/gi, 2],
    [/\bsuspensi[oó]n (?:provisional|definitiva)\b/gi, 3],
    [/\bacto reclamado\b/gi, 3],
    [/\bquejos[oa]\b/gi, 2],
  ],
  administrativo: [
    [/\bjuicio de nulidad\b/gi, 3],
    [/\btfja\b|\btribunal federal de justicia administrativa\b/gi, 3],
    [/\bley federal de procedimiento administrativo\b/gi, 3],
    [/\bresoluci[oó]n administrativa\b/gi, 2],
    [/\bprocedimiento administrativo sancionador\b/gi, 3],
    [/\blicitaci[oó]n p[uú]blica\b/gi, 2],
  ],
  fiscal: [
    [/\bc[oó]digo fiscal de la federaci[oó]n\b|\bcff\b/gi, 3],
    [/\bsat\b|\bservicio de administraci[oó]n tributaria\b/gi, 3],
    [/\bcr[eé]dito fiscal\b/gi, 3],
    [/\bvisita domiciliaria\b|\bfacultades de comprobaci[oó]n\b/gi, 3],
    [/\bdevoluci[oó]n de impuestos\b|\bisr\b|\biva\b/gi, 2],
    [/\bcfdi\b/gi, 2],
  ],
  constitucional: [
    // These two are the actual proceeding types this materia means:
    // controversia constitucional (a dispute between branches/levels of
    // government) and acción de inconstitucionalidad (filed by specific
    // qualified entities directly with the SCJN). Neither can co-occur
    // with amparo terminology in the same case — they're mutually
    // exclusive proceedings.
    [/\bcontroversia constitucional\b/gi, 3],
    [/\bacci[oó]n de inconstitucionalidad\b/gi, 3],
    // FIX: these three were weight 2 — decisive enough, combined with
    // repetition, to outscore amparo's own weight-3 signals on a case
    // whose SUBSTANCE is heavily about constitutional/human-rights
    // doctrine (e.g. an indigenous-rights amparo indirecto, which
    // legitimately discusses CPEUM, derechos humanos, and SCJN
    // jurisprudencia at length as the basis for its claim). None of these
    // three terms is exclusive to a controversia constitucional/acción de
    // inconstitucionalidad — amparo, penal, and administrativo cases
    // routinely cite them too. Confirmed on a real case (Amparo Indirecto
    // 412/2026, an indigenous-consultation matter): classified as
    // "constitucional" despite being unambiguously an amparo indirecto by
    // its own caption, which then drove the wrong procedural profile
    // (derechos_humanos instead of amparo) and produced report
    // recommendations to file a controversia constitucional / acción de
    // inconstitucionalidad — filings that don't apply to an individual
    // amparo proceeding at all. Downgraded to weak hints; see the
    // resolveMxCaseType() override below for the actual tie-break.
    [/\bcpeum\b|\bconstituci[oó]n pol[ií]tica de los estados unidos mexicanos\b/gi, 1],
    [/\bderechos humanos\b|\bcontrol de convencionalidad\b/gi, 1],
    [/\bjurisprudencia de la scjn\b/gi, 1],
  ],
  inmobiliario: [
    [/\bcompraventa\b/gi, 2],
    [/\bescritura p[uú]blica\b/gi, 3],
    [/\bnotario p[uú]blico\b/gi, 3],
    [/\bregistro p[uú]blico de la propiedad\b|\brpp\b/gi, 3],
    [/\bfolio real\b/gi, 3],
    [/\bcuenta predial\b|\bpredial\b/gi, 2],
    [/\bcatastro\b/gi, 2],
    [/\blibertad de gravamen\b|\bgravamen\b/gi, 2],
    [/\bfideicomiso\b/gi, 2],
    [/\blevantamiento topogr[aá]fico\b/gi, 2],
    [/\bcierre\b.{0,20}\binmueble\b|\bcierre inmobiliario\b/gi, 2],
    [/\bcancelaci[oó]n de hipoteca\b/gi, 3],
  ],
};

/** Folder/label aliases used by seeded corpora, mapped to a materia. */
const AREA_ALIASES: Record<string, MxCaseType> = {
  penal: "penal",
  criminal: "penal",
  familiar: "familiar",
  family: "familiar",
  civil: "civil",
  general_civil: "civil",
  mercantil: "mercantil",
  commercial: "mercantil",
  laboral: "laboral",
  employment: "laboral",
  amparo: "amparo",
  administrativo: "administrativo",
  administrative: "administrativo",
  fiscal: "fiscal",
  tax_law: "fiscal",
  constitucional: "constitucional",
  constitutional: "constitucional",
  inmobiliario: "inmobiliario",
  real_estate: "inmobiliario",
};

export function mxCaseTypeFromArea(area: string | null | undefined): MxCaseType | null {
  if (!area) return null;
  return AREA_ALIASES[area.trim().toLowerCase()] ?? null;
}

/**
 * Classify free text into a Mexican materia. Always returns a decision;
 * `confidence` reflects how dominant the winning materia was. With no signal
 * at all it falls back to `civil` at confidence 0.
 */
export function classifyMexicanCaseType(text: string | null | undefined): MxClassification {
  const scores: Record<string, number> = {};
  const matched: string[] = [];
  const haystack = (text ?? "").slice(0, 200_000);

  for (const [type, terms] of Object.entries(SIGNALS) as Array<[MxCaseType, Array<[RegExp, number]>]>) {
    let score = 0;
    for (const [re, weight] of terms) {
      const hits = haystack.match(re);
      if (!hits || hits.length === 0) continue;
      // Repeat hits add sub-linear value so one boilerplate phrase can't win alone.
      score += weight * (1 + Math.min(hits.length - 1, 4) * 0.25);
      matched.push(hits[0].toLowerCase());
    }
    scores[type] = Number(score.toFixed(2));
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((acc, [, v]) => acc + v, 0);
  let [topType, topScore] = ranked[0] ?? ["civil", 0];

  // Tie-break: "constitucional" means controversia constitucional / acción
  // de inconstitucionalidad specifically — proceedings that cannot co-occur
  // with amparo terminology in the same case (mutually exclusive filing
  // types). If "constitucional" is winning WITHOUT either of its own
  // decisive markers actually matching (i.e. purely on the weak, widely-
  // shared derechos-humanos/CPEUM/SCJN-jurisprudencia hints), and "amparo"
  // has any real signal at all, amparo should win — a case can legitimately
  // discuss human-rights doctrine at length as the SUBSTANCE of an amparo
  // claim (e.g. an indigenous-consultation amparo indirecto) without being
  // a controversia constitucional. Confirmed on a real case (Amparo
  // Indirecto 412/2026) misclassified as "constitucional", which then drove
  // the wrong procedural profile (derechos_humanos instead of amparo) and
  // produced report recommendations to file a controversia constitucional /
  // acción de inconstitucionalidad — filings that don't apply to an
  // individual amparo proceeding. `total` (the confidence denominator) is
  // deliberately left as the honest sum of every materia's raw signal —
  // only which materia is declared the winner changes.
  if (topType === "constitucional" && (scores.amparo ?? 0) > 0) {
    const decisiveConstitucionalHit = /\bcontroversia constitucional\b|\bacci[oó]n de inconstitucionalidad\b/gi.test(
      haystack,
    );
    if (!decisiveConstitucionalHit) {
      topType = "amparo";
      topScore = scores.amparo;
    }
  }

  if (!topScore) {
    return { caseType: "civil", confidence: 0, matched: [], scores };
  }
  return {
    caseType: topType as MxCaseType,
    confidence: Number((topScore / Math.max(total, 1)).toFixed(2)),
    matched: matched.slice(0, 12),
    scores,
  };
}

/**
 * Authoritative resolution for auto-seeded/auto-created cases: content wins
 * when it produces a confident signal, otherwise the declared corpus/folder
 * label is used, otherwise `civil`.
 */
export function resolveMxCaseType(args: {
  text?: string | null;
  declaredArea?: string | null;
}): { caseType: MxCaseType; source: "content" | "area" | "default"; classification: MxClassification } {
  const classification = classifyMexicanCaseType(args.text);
  const fromArea = mxCaseTypeFromArea(args.declaredArea);
  if (classification.confidence >= 0.3 && (classification.scores[classification.caseType] ?? 0) >= 4) {
    return { caseType: classification.caseType, source: "content", classification };
  }
  if (fromArea) return { caseType: fromArea, source: "area", classification };
  return { caseType: classification.caseType, source: "default", classification };
}

export const MX_CASE_TYPE_LABELS: Record<MxCaseType, { es: string; en: string }> = {
  penal: { es: "Penal", en: "Criminal" },
  familiar: { es: "Familiar", en: "Family" },
  civil: { es: "Civil", en: "Civil" },
  mercantil: { es: "Mercantil", en: "Commercial" },
  laboral: { es: "Laboral", en: "Labor" },
  amparo: { es: "Amparo", en: "Amparo" },
  administrativo: { es: "Administrativo", en: "Administrative" },
  fiscal: { es: "Fiscal", en: "Tax" },
  constitucional: { es: "Constitucional", en: "Constitutional" },
  inmobiliario: { es: "Bienes Raíces", en: "Real Estate" },
};
