// Domain Vocabulary Gate — pure module (no I/O, no AI).
//
// WHY: an agent's free-text output can be perfectly grounded (verbatim
// quote, verified against the corpus, on-topic per the relevance gate) and
// still assert something false: that a specific institution or procedural
// actor was involved, when the case's materia doesn't have that
// institution at all. Real example (ADR 4640/2017, Fabiola Romo Hernández
// — a CIVIL apelación reviewed via amparo directo en revisión):
// ways_out_analysis wrote "La resolución del Tribunal de Enjuiciamiento
// desestimó un argumento novedoso..." — "Tribunal de Enjuiciamiento" is the
// oral-trial tribunal in Mexico's accusatorial CRIMINAL procedure (CNPP).
// It does not exist in a civil dispute. None of the finding's own cited
// quotes even mention it — the agent supplied the term itself, defaulting
// to generic/criminal-flavored institutional vocabulary while paraphrasing
// a court's holding that was really issued by a Tribunal Colegiado /
// SCJN in an amparo proceeding.
//
// This is deliberately a DENYLIST, not an allowlist. Building a real
// per-materia allowlist of everything that's legitimately mentionable is a
// substantive legal-content judgment (which checklist items, institutions,
// and procedural stages genuinely apply to each materia) that this
// codebase has consistently deferred to the user's own legal research
// rather than have the model encode unilaterally (see classify.server.ts
// and procedural-compliance.ts's module headers for the same principle).
// A denylist of unambiguous, single-materia-exclusive institutional NAMES
// — not general legal concepts — needs no such judgment call: "Tribunal de
// Enjuiciamiento" and "Vinculación a Proceso" are real, specific,
// CNPP-defined institutions that simply do not exist outside penal
// procedure, full stop, regardless of the underlying facts of any given
// case. Terms here are cross-checked against classify.server.ts's own
// MATERIA_CATEGORY_RULES.penal vocabulary and case-type-standards.ts's
// penal-specific institutional references, so this list cannot silently
// diverge from what the rest of the codebase already treats as penal-only.

import type { MexicanCaseType } from "../jurisdiction/mexico-types";
import { isPenalMatter } from "./penal-legal-normalization";

type DomainTerm = { match: RegExp; label: string };

// Institutions and procedural actors that exist ONLY in the accusatorial
// criminal procedure (CNPP) — never in civil, mercantil, laboral,
// familiar, fiscal, administrativo, constitucional, amparo, electoral,
// agrario, ambiental, or inmobiliario matters.
const PENAL_ONLY_TERMS: DomainTerm[] = [
  { match: /\btribunal(?:es)?\s+de\s+enjuiciamiento\b/i, label: "Tribunal de Enjuiciamiento" },
  { match: /\bjuez(?:a)?\s+de\s+control\b/i, label: "Juez de Control" },
  { match: /\bministerio\s+p[uú]blico\b/i, label: "Ministerio Público" },
  { match: /\bfiscal[ií]a\b/i, label: "Fiscalía" },
  { match: /\bcarpeta\s+de\s+investigaci[oó]n\b/i, label: "Carpeta de Investigación" },
  { match: /\baudiencia\s+inicial\b/i, label: "Audiencia Inicial" },
  { match: /\bvinculaci[oó]n\s+a\s+proceso\b/i, label: "Vinculación a Proceso" },
  { match: /\bformulaci[oó]n\s+de\s+imputaci[oó]n\b/i, label: "Formulación de Imputación" },
  { match: /\bprisi[oó]n\s+preventiva\b/i, label: "Prisión Preventiva" },
  { match: /\bprocedimiento\s+abreviado\b/i, label: "Procedimiento Abreviado" },
  { match: /\betapa\s+intermedia\b/i, label: "Etapa Intermedia" },
  { match: /\bauto\s+de\s+apertura\s+a\s+juicio\b/i, label: "Auto de Apertura a Juicio" },
  { match: /\bjuicio\s+oral\b/i, label: "Juicio Oral" },
  { match: /\bcriterio\s+de\s+oportunidad\b/i, label: "Criterio de Oportunidad" },
  { match: /\bacuerdo\s+reparatorio\b/i, label: "Acuerdo Reparatorio" },
  {
    match: /\bsuspensi[oó]n\s+condicional\s+del\s+proceso\b/i,
    label: "Suspensión Condicional del Proceso",
  },
];

const MATERIAS_WITHOUT_PENAL_INSTITUTIONS: ReadonlySet<MexicanCaseType> = new Set([
  "civil",
  "mercantil",
  "laboral",
  "familiar",
  "fiscal",
  "administrativo",
  "constitucional",
  "amparo",
  "electoral",
  "agrario",
  "ambiental",
  "inmobiliario",
]);

export type DomainVocabularyCheck = {
  clean: boolean;
  violations: string[];
};

/**
 * Checks a finding's own text (title + description — NOT its cited quotes,
 * which are independently verified elsewhere) for institutional vocabulary
 * that cannot exist in the case's actual materia. Always `clean: true` for
 * materia "penal" or an unrecognized/unset materia — this gate only fires
 * when we positively know the case is NOT penal.
 */
export function checkDomainVocabulary(
  text: string,
  materia: string | undefined,
  underlyingMateria?: string | null,
): DomainVocabularyCheck {
  // Amparo is a procedural vehicle, not the underlying materia.  Penal-
  // origin Amparo legitimately contains CNPP actors and institutions; only
  // a positively non-Penal underlying matter may activate this denylist.
  if (isPenalMatter({ matter: materia, underlyingMatter: underlyingMateria })) {
    return { clean: true, violations: [] };
  }
  if (!materia || !MATERIAS_WITHOUT_PENAL_INSTITUTIONS.has(materia as MexicanCaseType)) {
    return { clean: true, violations: [] };
  }
  const violations = PENAL_ONLY_TERMS.filter((t) => t.match.test(text)).map((t) => t.label);
  return { clean: violations.length === 0, violations };
}

export function checkFindingDomainVocabulary(
  finding: { title?: unknown; description?: unknown },
  materia: string | undefined,
  underlyingMateria?: string | null,
): DomainVocabularyCheck {
  const text = `${String(finding.title ?? "")} ${String(finding.description ?? "")}`;
  return checkDomainVocabulary(text, materia, underlyingMateria);
}

