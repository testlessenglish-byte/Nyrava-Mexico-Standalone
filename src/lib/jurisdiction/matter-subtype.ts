// Matter-subtype lock — PURE MODULE (no I/O, no AI).
//
// WHY: a materia is not always a single legal domain. `familiar` in México
// bundles two barely-overlapping worlds: (a) family disputes — divorcio,
// guarda y custodia, alimentos, violencia familiar — and (b) sucesiones —
// testamentario / intestamentario, albacea, herederos, masa hereditaria.
// The materia-level engine policy (MX_ENGINES) enables the family-dispute
// investigator agents for BOTH, so a juicio sucesorio testamentario was
// running `agent:custody_best_interest_analysis`,
// `agent:child_support_calculation` and `agent:domestic_violence_assessment`
// and attaching their category labels to succession findings.
//
// This module narrows — never widens — the materia policy, deterministically,
// from case text. It is registry-driven: no engine or materia behaviour is
// hard-coded at a call site.

export type SubtypeRule = {
  /** Stable subtype key. */
  key: string;
  label: string;
  /** Text signals that identify the subtype. */
  signals: RegExp;
  /** Signals that mean the excluded domain IS genuinely in play — rule stands down. */
  counterSignals?: RegExp;
  /** Engines that must NOT run for this subtype. */
  excludedEngines: readonly string[];
};

export type MatterSubtype = {
  key: string;
  label: string;
  excludedEngines: readonly string[];
};

/** Accent-folded lowercase text for signal matching. */
function fold(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export const MATTER_SUBTYPE_RULES: Record<string, readonly SubtypeRule[]> = {
  familiar: [
    {
      key: "sucesorio",
      label: "Juicio sucesorio",
      signals:
        /\b(sucesori[oa]|sucesion(?:es)?|testamentari[oa]|intestamentari[oa]|intestad[oa]|testamento|testador[a]?|albace[a]|herencia|hereder[oa]s?|legatari[oa]s?|masa hereditaria|de cujus|caudal hereditario|inventario y avaluo)\b/,
      counterSignals:
        /\b(guarda y custodia|patria potestad|pension alimenticia|alimentos provisionales|violencia familiar|convivencia supervisada|divorcio|interes superior del menor|reconocimiento de paternidad)\b/,
      excludedEngines: [
        "agent:custody_best_interest_analysis",
        "agent:child_support_calculation",
        "agent:domestic_violence_assessment",
      ],
    },
  ],
  // Real case: a 1-document corpus consisting of "AMPARO DIRECTO EN
  // REVISIÓN 4640/2017" (an SCJN constitutional-analysis resolution, not a
  // full first-instance expediente) still ran the standing/procedencia,
  // suspensión, and authority-notification/informe-justificado investigator
  // agents — all of which examine facts of the ORIGINAL amparo trial
  // (interés jurídico, definitividad, suspensión granted/denied, informe
  // justificado filed) that an SCJN review opinion has no reason to restate.
  // See effectiveMxProfile's AMPARO_REVISION_TEXT_SIGNAL (mx-pipeline.ts)
  // for the companion fix that also routes the deterministic
  // procedural_compliance checklist away from the base amparo checklist for
  // the same subtype. conventionality_pro_persona, constitutional_rights_
  // mapping, international_human_rights_analysis, and
  // constitutional_controversy_analysis are deliberately NOT excluded — an
  // SCJN review opinion is exactly what those agents are for.
  amparo: [
    {
      key: "directo_en_revision",
      label: "Amparo Directo en Revisión (SCJN)",
      signals:
        /\b(amparo directo en revision|amparo indirecto en revision|adr\s+\d+\s*\/\s*\d+|amparo en revision ante la (scjn|suprema corte))\b/,
      excludedEngines: [
        "agent:standing_procedencia",
        "agent:suspension_analysis",
        "agent:authority_notification_validation",
      ],
    },
  ],
};

/**
 * Resolve the subtype of a matter from its materia plus free text
 * (case name + description + corpus head). Returns null when no rule applies,
 * which leaves the materia-level policy untouched.
 */
export function detectMatterSubtype(materia: string, text: string): MatterSubtype | null {
  const rules = MATTER_SUBTYPE_RULES[fold(materia)];
  if (!rules || rules.length === 0) return null;
  const haystack = fold(text);
  if (!haystack) return null;
  for (const rule of rules) {
    if (!rule.signals.test(haystack)) continue;
    if (rule.counterSignals?.test(haystack)) continue;
    return { key: rule.key, label: rule.label, excludedEngines: rule.excludedEngines };
  }
  return null;
}

/** False when the subtype lock forbids this engine. */
export function isEngineAllowedForSubtype(subtype: MatterSubtype | null, engineId: string): boolean {
  if (!subtype) return true;
  return !subtype.excludedEngines.includes(engineId);
}

export const SKIP_REASON_SUBTYPE_NOT_APPLICABLE = "subtype_not_applicable";
