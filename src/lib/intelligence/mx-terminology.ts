// =============================================================================
// MX LEGAL TERMINOLOGY GUARD — pure module (no IO, no React, no Supabase).
//
// Two responsibilities:
//   1. REMEDIATE: deterministically rewrite US/common-law terminology and
//      wrong party-role labels into the correct Mexican procedural term for
//      the case's materia (profile).
//   2. AUDIT: after remediation, detect anything that must never reach a
//      Mexican legal report — residual US terminology, US jurisdiction /
//      constitutional references, party roles that don't exist in the
//      materia, procedural codes from the wrong materia, and untranslated
//      English sentences when the report language is Spanish.
//
// Consumed by `legal-qa.server.ts` (stage `legal_qa` — "Control de Calidad
// Jurídica"), which runs immediately before report generation and blocks it
// when a blocking violation survives remediation.
// =============================================================================

import type { MxPipelineProfile } from "../execution/mx-pipeline";

export type ViolationSeverity = "blocking" | "warning";

export type QaViolationKind =
  | "us_terminology"
  | "us_jurisdiction_reference"
  | "party_role_mismatch"
  | "wrong_procedural_code"
  | "untranslated_english";

export type QaViolation = {
  kind: QaViolationKind;
  severity: ViolationSeverity;
  /** The literal offending text found. */
  match: string;
  /** Human-readable explanation, in Spanish (platform default). */
  detail: string;
};

export type Replacement = { from: string; to: string };

// -----------------------------------------------------------------------------
// Party roles, per materia.
// -----------------------------------------------------------------------------

/** Procedural party roles that legitimately exist in each materia. */
export const PARTY_ROLES_BY_PROFILE: Record<MxPipelineProfile, readonly string[]> = {
  penal: ["imputado", "víctima", "ofendido", "Ministerio Público", "Fiscalía", "defensa", "asesor jurídico"],
  amparo: ["quejoso", "quejosa", "autoridad responsable", "tercero interesado", "Ministerio Público Federal"],
  derechos_humanos: ["víctima", "quejoso", "autoridad responsable", "Comisión de Derechos Humanos"],
  constitucional: [
    "promovente",
    "autoridad responsable",
    "tercero interesado",
    "órgano o poder demandado",
  ],
  laboral: ["trabajador", "patrón", "parte actora", "parte demandada", "sindicato"],
  civil: ["parte actora", "parte demandada", "tercero llamado a juicio"],
  familiar: ["parte actora", "parte demandada", "menor", "tutor"],
  mercantil: ["parte actora", "parte demandada", "endosante", "suscriptor"],
  fiscal: ["contribuyente", "autoridad fiscal", "parte actora", "parte demandada"],
  administrativo: ["particular", "autoridad administrativa", "parte actora", "parte demandada"],
  apelacion: ["apelante", "apelado", "recurrente", "autoridad de origen"],
  inmobiliario: ["comprador", "vendedor", "Notario Público", "acreedor hipotecario"],
  agrario: ["parte actora", "parte demandada", "núcleo agrario", "ejidatario", "comunero", "comisariado ejidal"],
  electoral: ["actor", "autoridad responsable", "tercero interesado", "partido político", "candidato"],
  ambiental: ["particular", "autoridad", "comunidad afectada", "PROFEPA", "ASEA", "CONAGUA"],
  responsabilidad_medica: ["paciente", "médico", "institución de salud", "parte actora", "parte demandada"],
};

/** Materia-appropriate substitution for each US party-role label. */
const PARTY_ROLE_SUBSTITUTIONS: Record<MxPipelineProfile, Record<string, string>> = {
  penal: {
    prosecution: "Ministerio Público",
    prosecutor: "Ministerio Público",
    "district attorney": "Ministerio Público",
    plaintiff: "víctima u ofendido",
    defendant: "imputado",
  },
  amparo: {
    prosecution: "autoridad responsable",
    prosecutor: "autoridad responsable",
    "district attorney": "autoridad responsable",
    plaintiff: "parte quejosa",
    defendant: "autoridad responsable",
  },
  derechos_humanos: {
    prosecution: "autoridad responsable",
    prosecutor: "autoridad responsable",
    "district attorney": "autoridad responsable",
    plaintiff: "víctima",
    defendant: "autoridad responsable",
  },
  constitucional: {
    prosecution: "autoridad responsable",
    prosecutor: "autoridad responsable",
    "district attorney": "autoridad responsable",
    plaintiff: "parte promovente",
    defendant: "autoridad responsable",
  },
  laboral: {
    prosecution: "parte actora",
    prosecutor: "parte actora",
    "district attorney": "parte actora",
    plaintiff: "parte actora",
    defendant: "parte demandada",
  },
  civil: {
    prosecution: "parte actora",
    prosecutor: "parte actora",
    "district attorney": "parte actora",
    plaintiff: "parte actora",
    defendant: "parte demandada",
  },
  familiar: {
    prosecution: "parte actora",
    prosecutor: "parte actora",
    "district attorney": "parte actora",
    plaintiff: "parte actora",
    defendant: "parte demandada",
  },
  mercantil: {
    prosecution: "parte actora",
    prosecutor: "parte actora",
    "district attorney": "parte actora",
    plaintiff: "parte actora",
    defendant: "parte demandada",
  },
  fiscal: {
    prosecution: "autoridad fiscal",
    prosecutor: "autoridad fiscal",
    "district attorney": "autoridad fiscal",
    plaintiff: "contribuyente",
    defendant: "autoridad fiscal",
  },
  administrativo: {
    prosecution: "autoridad administrativa",
    prosecutor: "autoridad administrativa",
    "district attorney": "autoridad administrativa",
    plaintiff: "parte actora",
    defendant: "autoridad administrativa",
  },
  apelacion: {
    prosecution: "parte recurrente",
    prosecutor: "parte recurrente",
    "district attorney": "parte recurrente",
    plaintiff: "apelante",
    defendant: "apelado",
  },
  inmobiliario: {
    // No adversarial roles in a closing; these exist only to catch a
    // mis-generated prompt that leaked litigation vocabulary in.
    prosecution: "vendedor",
    prosecutor: "vendedor",
    "district attorney": "vendedor",
    plaintiff: "comprador",
    defendant: "vendedor",
  },
  agrario: {
    prosecution: "parte actora",
    prosecutor: "parte actora",
    "district attorney": "parte actora",
    plaintiff: "parte actora",
    defendant: "parte demandada",
  },
  electoral: {
    prosecution: "actor",
    prosecutor: "actor",
    "district attorney": "autoridad responsable",
    plaintiff: "actor",
    defendant: "autoridad responsable",
  },
  ambiental: {
    prosecution: "autoridad",
    prosecutor: "autoridad",
    "district attorney": "autoridad",
    plaintiff: "comunidad afectada",
    defendant: "particular",
  },
  responsabilidad_medica: {
    prosecution: "paciente",
    prosecutor: "paciente",
    "district attorney": "paciente",
    plaintiff: "paciente",
    defendant: "médico",
  },
};

// -----------------------------------------------------------------------------
// US / common-law terminology → Mexican equivalent.
// Ordered longest-phrase-first so "discovery violation" is rewritten before
// the bare "discovery" rule can fire.
// -----------------------------------------------------------------------------

type TermRule = {
  /** Case-insensitive source phrase (word-boundary matched). */
  term: string;
  /** Replacement, or a per-profile map. `null` = no safe rewrite (blocks). */
  to: string | Partial<Record<MxPipelineProfile, string>> | null;
};

const US_TERM_RULES: readonly TermRule[] = [
  // Discovery family — the exact leak seen in production reports.
  { term: "discovery violation", to: "omisión en el deber de aportación probatoria" },
  { term: "discovery violations", to: "omisiones en el deber de aportación probatoria" },
  { term: "discovery gaps", to: "lagunas probatorias" },
  { term: "discovery gap", to: "laguna probatoria" },
  { term: "discovery request", to: "solicitud de prueba" },
  { term: "discovery dispute", to: "controversia probatoria" },
  {
    term: "discovery",
    to: {
      penal: "descubrimiento probatorio",
      amparo: "ofrecimiento de pruebas",
      derechos_humanos: "ofrecimiento de pruebas",
      laboral: "ofrecimiento y desahogo de pruebas",
      civil: "ofrecimiento y desahogo de pruebas",
      familiar: "ofrecimiento y desahogo de pruebas",
      mercantil: "ofrecimiento y desahogo de pruebas",
      fiscal: "ofrecimiento de pruebas",
      administrativo: "ofrecimiento de pruebas",
      apelacion: "ofrecimiento de pruebas",
    },
  },
  // Party roles.
  { term: "district attorney", to: null },
  { term: "prosecutor's office", to: null },
  { term: "prosecutor", to: null },
  { term: "prosecution", to: null },
  { term: "plaintiff's", to: null },
  { term: "plaintiffs", to: null },
  { term: "plaintiff", to: null },
  { term: "defendant's", to: null },
  { term: "defendants", to: null },
  { term: "defendant", to: null },
  // Procedure / evidence.
  { term: "jury trial", to: { penal: "juicio oral ante Tribunal de Enjuiciamiento" } },
  { term: "grand jury", to: "acusación del Ministerio Público" },
  { term: "jury instruction", to: "instrucción del tribunal" },
  { term: "jury", to: { penal: "Tribunal de Enjuiciamiento" } },
  { term: "motion in limine", to: "incidente de exclusión de prueba" },
  { term: "motion to dismiss", to: "solicitud de sobreseimiento" },
  { term: "summary judgment", to: "resolución sin necesidad de juicio" },
  { term: "deposition", to: "declaración testimonial" },
  { term: "subpoena", to: "citación judicial" },
  { term: "hearsay", to: "testimonio de oídas" },
  { term: "exclusionary rule", to: "regla de exclusión de prueba ilícita" },
  { term: "plea bargain", to: "procedimiento abreviado" },
  { term: "plea deal", to: "procedimiento abreviado" },
  { term: "indictment", to: "escrito de acusación" },
  { term: "arraignment", to: "audiencia inicial" },
  { term: "felony", to: "delito grave" },
  { term: "misdemeanor", to: "delito no grave" },
  { term: "tort", to: "responsabilidad civil extracontractual" },
  { term: "punitive damages", to: "daño punitivo (no aplicable en México)" },
  { term: "stare decisis", to: null },
  { term: "miranda", to: null },
  { term: "miranda rights", to: null },
  { term: "burden of proof", to: "carga de la prueba" },
  { term: "cross-examination", to: "interrogatorio de contraparte" },
  // Stray English words/abbreviations that leak into otherwise-Spanish
  // narrative prose. Distinct bug class from the terms above: those are
  // legal-terminology substitutions; these are plain prose words an LLM
  // occasionally leaves in English mid-sentence. findEnglishSentences()
  // structurally can't catch this pattern — it only flags whole sentences
  // that read as majority-English (8+ words, 4+ English markers), so a
  // single English adjective or abbreviation sitting inside an otherwise-
  // Spanish sentence sails through untouched. Caught here instead, at the
  // same word-boundary/case-preserving remediation pass everything else on
  // this list goes through.
  { term: "well-supported", to: "bien respaldado" },
  { term: "well supported", to: "bien respaldado" },
  { term: "well-established", to: "bien establecido" },
  { term: "well established", to: "bien establecido" },
  { term: "TBD", to: "Pendiente" },
  { term: "TBA", to: "Por confirmar" },
];

/** Hard US-jurisdiction references — never auto-rewritten, always blocking. */
const US_JURISDICTION_PATTERNS: readonly { re: RegExp; detail: string }[] = [
  {
    re: /\b(first|second|fourth|fifth|sixth|eighth|fourteenth)\s+amendment\b/gi,
    detail: "Referencia a una enmienda de la Constitución de EE. UU.; el marco aplicable es la CPEUM.",
  },
  { re: /\bFRCP\b/g, detail: "Referencia a las Federal Rules of Civil Procedure (EE. UU.)." },
  { re: /\bFRE\b/g, detail: "Referencia a las Federal Rules of Evidence (EE. UU.)." },
  { re: /\bU\.?S\.?C\.?\s*§/g, detail: "Cita al United States Code." },
  { re: /\b\d+\s+F\.\s?\d?d\s+\d+\b/g, detail: "Cita a un reporter federal estadounidense (F.2d/F.3d)." },
  { re: /\bU\.?S\.?\s+Supreme\s+Court\b/gi, detail: "Referencia a la Suprema Corte de EE. UU.; corresponde la SCJN." },
  { re: /\bstate\s+bar\b/gi, detail: "Referencia a un colegio de abogados estadounidense." },
];

/** Procedural codes that belong to a specific materia. */
const CODE_SCOPE: readonly { re: RegExp; code: string; allowed: readonly MxPipelineProfile[] }[] = [
  {
    re: /\bCNPP\b/g,
    code: "CNPP",
    allowed: ["penal", "amparo", "derechos_humanos", "apelacion"],
  },
  {
    re: /\bC[óo]digo\s+Nacional\s+de\s+Procedimientos\s+Penales\b/gi,
    code: "Código Nacional de Procedimientos Penales",
    allowed: ["penal", "amparo", "derechos_humanos", "apelacion"],
  },
  {
    re: /\bLFT\b/g,
    code: "LFT",
    allowed: ["laboral", "amparo", "apelacion"],
  },
  {
    re: /\bCFF\b/g,
    code: "CFF",
    allowed: ["fiscal", "amparo", "administrativo", "apelacion"],
  },
];

// -----------------------------------------------------------------------------
// Remediation.
// -----------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordBoundaryRe(term: string): RegExp {
  // Unicode-aware boundaries: avoid matching inside a longer Spanish word.
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, "giu");
}

function preserveCase(source: string, replacement: string): string {
  if (source === source.toUpperCase() && source.length > 3) return replacement.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

function resolveTermReplacement(rule: TermRule, profile: MxPipelineProfile): string | null {
  if (rule.to === null) return PARTY_ROLE_SUBSTITUTIONS[profile][rule.term] ?? null;
  if (typeof rule.to === "string") return rule.to;
  return rule.to[profile] ?? null;
}

/**
 * Rewrite every US/common-law term that has a safe Mexican equivalent for
 * this materia. Terms with no safe equivalent are left untouched so the audit
 * pass can block on them.
 */
export function remediateText(
  text: string,
  profile: MxPipelineProfile,
): { text: string; replacements: Replacement[] } {
  let out = text;
  const replacements: Replacement[] = [];
  for (const rule of US_TERM_RULES) {
    const to = resolveTermReplacement(rule, profile);
    if (!to) continue;
    const re = wordBoundaryRe(rule.term);
    if (!re.test(out)) continue;
    out = out.replace(wordBoundaryRe(rule.term), (m) => {
      replacements.push({ from: m, to });
      return preserveCase(m, to);
    });
  }
  return { text: out, replacements };
}

// -----------------------------------------------------------------------------
// Party-role gender remediation.
// -----------------------------------------------------------------------------
// Real bug (ADR 4640/2017, Fabiola Romo Hernández — Amparo Directo en
// Revisión): every generated finding said "el quejoso"/"El quejoso alega..."
// even though the case's own party is a woman and the source document's
// caption uses the feminine role term. This is a DETERMINISTIC extraction
// failure, not a model-ambiguity one: a party's grammatical role gender is
// never guessed from their name (a name is not a reliable gender signal —
// see this session's own pronoun-inference rule) — it is only ever read
// from the LITERAL role marker the source document itself uses in its
// caption/body ("QUEJOSA" vs "QUEJOSO"). When the corpus establishes ONE
// form unambiguously, every occurrence of the OTHER form anywhere in
// generated findings is corrected to match — never the reverse, and never
// when the corpus contains both forms (multiple parties, or no single
// correction can be made safely).

export type GenderedPartyRole = "quejoso" | "actor" | "demandado" | "tercero_interesado";

const GENDERED_ROLE_PAIRS: Record<GenderedPartyRole, { m: string; f: string }> = {
  quejoso: { m: "quejoso", f: "quejosa" },
  actor: { m: "actor", f: "actora" },
  demandado: { m: "demandado", f: "demandada" },
  tercero_interesado: { m: "tercero interesado", f: "tercera interesada" },
};

/**
 * Scans real corpus text (the case's own extracted document text — never a
 * party's name) for an explicit, unambiguous grammatical role marker per
 * role. Returns which form ("m" | "f") the corpus itself establishes for
 * each role that appears in exactly one form; a role that doesn't appear at
 * all, or appears in BOTH forms (ambiguous — multiple parties, or no single
 * safe correction), is simply absent from the result.
 */
export function detectPartyGenderFromCorpus(
  corpusText: string,
): Partial<Record<GenderedPartyRole, "m" | "f">> {
  const result: Partial<Record<GenderedPartyRole, "m" | "f">> = {};
  for (const [role, forms] of Object.entries(GENDERED_ROLE_PAIRS) as Array<
    [GenderedPartyRole, { m: string; f: string }]
  >) {
    const hasF = wordBoundaryRe(forms.f).test(corpusText);
    const hasM = wordBoundaryRe(forms.m).test(corpusText);
    if (hasF && !hasM) result[role] = "f";
    else if (hasM && !hasF) result[role] = "m";
  }
  return result;
}

/**
 * Rewrites every gendered party-role mention in `text` to match the form
 * `genderMap` establishes from the real corpus (see
 * detectPartyGenderFromCorpus). Same replacement-tracking shape as
 * remediateText, so callers can merge both into one remediation log.
 */
export function remediatePartyGender(
  text: string,
  genderMap: Partial<Record<GenderedPartyRole, "m" | "f">>,
): { text: string; replacements: Replacement[] } {
  let out = text;
  const replacements: Replacement[] = [];
  for (const [role, forms] of Object.entries(GENDERED_ROLE_PAIRS) as Array<
    [GenderedPartyRole, { m: string; f: string }]
  >) {
    const target = genderMap[role];
    if (!target) continue;
    const wrongForm = target === "f" ? forms.m : forms.f;
    const rightForm = target === "f" ? forms.f : forms.m;
    // "del"/"al" (de+el, a+el) are masculine-only contractions — going to
    // feminine expands them ("del quejoso" -> "de la quejosa"); going to
    // masculine, the bare "la"/"La" branch below handles the noun and the
    // de-el/a-el cleanup pass after the loop re-contracts "de el"/"a el"
    // back to "del"/"al".
    const articleAlternatives = target === "f" ? "del|al|el|la|Del|Al|El|La" : "el|la|El|La";
    const expandedArticle: Record<string, string> = {
      del: "de la",
      al: "a la",
      Del: "De la",
      Al: "A la",
    };
    const rightArticle = target === "f" ? "la" : "el";
    // Match an optional leading definite article (or de-el/a-el
    // contraction) together with the noun phrase, so the article is
    // corrected to agree too — otherwise "El quejoso" naively becomes the
    // ungrammatical "El quejosa" instead of "La quejosa".
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])(${articleAlternatives})?(\\s*)${escapeRe(wrongForm)}(?![\\p{L}\\p{N}])`,
      "gu",
    );
    if (!re.test(out)) continue;
    out = out.replace(re, (m, article: string | undefined, space: string) => {
      const noun = preserveCase(wrongForm, rightForm);
      const fixedArticle = article
        ? (expandedArticle[article] ?? preserveCase(article, rightArticle))
        : "";
      const to = `${fixedArticle}${space ?? ""}${noun}`;
      replacements.push({ from: m, to });
      return to;
    });
  }
  // Cleanup pass: correcting toward masculine can leave "de el"/"a el"
  // where the source had "de la"/"a la" before the noun (this function only
  // captures ONE preceding word, so the contraction with "de"/"a" one word
  // further back isn't rebuilt inline) — re-contract to proper Spanish.
  out = out.replace(/\bde el\b/g, "del").replace(/\bDe el\b/g, "Del");
  out = out.replace(/\ba el\b/g, "al").replace(/\bA el\b/g, "Al");
  return { text: out, replacements };
}

// -----------------------------------------------------------------------------
// English-sentence detection (only meaningful when the report is Spanish).
// -----------------------------------------------------------------------------

const EN_MARKERS = new Set([
  "the", "of", "and", "is", "was", "were", "with", "that", "this", "which", "been", "have", "has",
  "should", "would", "could", "there", "their", "these", "those", "from", "will", "shall", "must",
  "because", "however", "therefore", "does", "did", "not", "under", "against", "evidence", "court",
  "case", "claim", "filed", "failure", "record",
]);

const ES_MARKERS = new Set([
  "el", "la", "los", "las", "de", "del", "que", "en", "y", "se", "por", "con", "para", "un", "una",
  "es", "son", "fue", "fueron", "no", "sí", "sobre", "conforme", "artículo", "prueba", "caso",
  "juicio", "tribunal", "autoridad", "hechos", "derecho", "acuerdo", "porque", "además",
]);

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;:])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Sentences that read as untranslated English. Conservative by design. */
export function findEnglishSentences(text: string): string[] {
  const out: string[] = [];
  for (const sentence of splitSentences(text)) {
    const words = sentence.toLowerCase().match(/[\p{L}']+/gu) ?? [];
    if (words.length < 8) continue;
    let en = 0;
    let es = 0;
    for (const w of words) {
      if (EN_MARKERS.has(w)) en += 1;
      if (ES_MARKERS.has(w)) es += 1;
    }
    if (/[áéíóúñ¿¡]/i.test(sentence)) es += 2;
    if (en >= 4 && en > es * 2) out.push(sentence.slice(0, 300));
  }
  return out;
}

// -----------------------------------------------------------------------------
// Audit.
// -----------------------------------------------------------------------------

export type AuditOptions = {
  profile: MxPipelineProfile;
  /** Report language of the case; English-sentence checks only run for "es". */
  locale: "es" | "en";
};

/** Full terminology/jurisdiction audit of one text segment. */
export function auditText(text: string, opts: AuditOptions): QaViolation[] {
  const violations: QaViolation[] = [];
  if (!text || !text.trim()) return violations;
  const { profile, locale } = opts;

  // 1. Residual US terminology (anything still present after remediation).
  for (const rule of US_TERM_RULES) {
    const m = text.match(wordBoundaryRe(rule.term));
    if (!m) continue;
    const isPartyRole = rule.term in PARTY_ROLE_SUBSTITUTIONS[profile];
    violations.push({
      kind: isPartyRole ? "party_role_mismatch" : "us_terminology",
      severity: "blocking",
      match: m[0],
      detail: isPartyRole
        ? `"${m[0]}" no es una parte procesal válida en materia ${profile}; los roles correctos son: ${PARTY_ROLES_BY_PROFILE[profile].join(", ")}.`
        : `Terminología del sistema estadounidense ("${m[0]}") prohibida en un informe mexicano.`,
    });
  }

  // 2. US jurisdiction / constitutional references.
  for (const p of US_JURISDICTION_PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      violations.push({
        kind: "us_jurisdiction_reference",
        severity: "blocking",
        match: m[0],
        detail: p.detail,
      });
    }
  }

  // 3. Procedural code cited outside its materia.
  for (const c of CODE_SCOPE) {
    if (c.allowed.includes(profile)) continue;
    const m = text.match(c.re);
    if (m) {
      violations.push({
        kind: "wrong_procedural_code",
        severity: "warning",
        match: m[0],
        detail: `Se cita ${c.code}, que no corresponde a la materia ${profile}.`,
      });
    }
  }

  // 4. Untranslated English prose in a Spanish report.
  if (locale === "es") {
    for (const s of findEnglishSentences(text)) {
      violations.push({
        kind: "untranslated_english",
        severity: "blocking",
        match: s,
        detail: "Oración en inglés sin traducir en un informe cuyo idioma es español.",
      });
    }
  }

  return violations;
}

/** Convenience: dedupe violations by kind+match, keeping the worst severity. */
export function dedupeViolations(violations: QaViolation[]): QaViolation[] {
  const map = new Map<string, QaViolation>();
  for (const v of violations) {
    const k = `${v.kind}::${v.match.toLowerCase()}`;
    const prev = map.get(k);
    if (!prev || (prev.severity === "warning" && v.severity === "blocking")) map.set(k, v);
  }
  return [...map.values()];
}
