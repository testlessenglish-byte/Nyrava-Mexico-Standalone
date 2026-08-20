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
  migratorio: [
    {
      key: "refugio_proteccion",
      label: "Refugio y protección complementaria",
      signals: /\b(refugio|refugiado|comar|proteccion complementaria|no devolucion|asilo politico)\b/,
      excludedEngines: ["agent:nationality_naturalization_analysis"],
    },
    {
      key: "nacionalidad_naturalizacion",
      label: "Nacionalidad y naturalización",
      signals: /\b(nacionalidad|naturalizacion|doble nacionalidad|declaratoria de nacionalidad|certificado de nacionalidad)\b/,
      excludedEngines: [
        "agent:refugee_non_refoulement_analysis",
        "agent:immigration_deadline_continuity",
      ],
    },
    {
      key: "detencion_retorno_deportacion",
      label: "Detención, retorno, deportación o expulsión",
      signals: /\b(estacion migratoria|detencion migratoria|retorno asistido|deportacion|expulsion|orden de salida|restriccion de reingreso)\b/,
      excludedEngines: ["agent:nationality_naturalization_analysis"],
    },
    {
      key: "empleador_movilidad",
      label: "Empleador, trabajo y movilidad corporativa",
      signals: /\b(empleador|oferta de empleo|actividades remuneradas|permiso para trabajar|movilidad corporativa|personal extranjero)\b/,
      excludedEngines: [
        "agent:refugee_non_refoulement_analysis",
        "agent:nationality_naturalization_analysis",
      ],
    },
    {
      key: "estancia_regularizacion",
      label: "Estancia, residencia y regularización",
      signals: /\b(residencia temporal|residencia permanente|condicion de estancia|regularizacion migratoria|canje de visa|renovacion migratoria)\b/,
      excludedEngines: [
        "agent:refugee_non_refoulement_analysis",
        "agent:nationality_naturalization_analysis",
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

// FIX (2026-08-17): the subtype lock above only ever gated the AGENTS stage
// (pipeline.server.ts's investigator-agent loop) — the excluded engines
// simply never ran, so they could never generate a suspensión/standing/
// custody/alimentos finding in the first place. runStrategyEngine
// (litigation.server.ts) is a SEPARATE LLM call that synthesizes motion
// recommendations directly from the case brief with no awareness of this
// lock at all, so it could (and did, on a real case) recommend "Solicitar
// la suspensión..." on an Amparo Directo en Revisión — a proceeding whose
// own subtype lock exists specifically because an SCJN review opinion has
// no reason to relitigate the original trial's suspensión. Each entry below
// is drawn from the corresponding excluded agent's own system prompt
// (pipeline.server.ts's AGENTS array) — the specific procedural vocabulary
// that ONLY makes sense for that excluded topic, not a general materia
// denylist.
const SUBTYPE_EXCLUDED_TOPIC_SIGNALS: Record<string, RegExp> = {
  "agent:standing_procedencia":
    /\b(interes juridico|interes legitimo|principio de definitividad|principio de subsidiariedad|procedencia del amparo|improcedencia del amparo)\b/,
  "agent:suspension_analysis":
    /\b(suspension de oficio|suspension a peticion de parte|suspension provisional|suspension definitiva|solicitar la suspension|suspender el acto reclamado)\b/,
  "agent:authority_notification_validation":
    /\b(informe justificado|notificacion a la autoridad responsable|competencia de la autoridad responsable|notificacion defectuosa)\b/,
  "agent:custody_best_interest_analysis":
    /\b(guarda y custodia|interes superior del menor|convivencia supervisada|regimen de convivencia|patria potestad)\b/,
  "agent:child_support_calculation":
    /\b(pension alimenticia|alimentos provisionales|obligacion alimentaria|incidente de alimentos)\b/,
  "agent:domestic_violence_assessment":
    /\b(violencia familiar|violencia domestica|orden de proteccion|medida de proteccion)\b/,
};

/**
 * True unless `text` touches a topic this subtype's excluded engines exist
 * specifically to keep out of scope — the free-text counterpart to
 * isEngineAllowedForSubtype, for content produced by an LLM call that never
 * ran through the AGENTS-stage engine loop at all (e.g. runStrategyEngine's
 * motion/next-action recommendations).
 */
export function isTextAllowedForSubtype(subtype: MatterSubtype | null, text: string): boolean {
  if (!subtype) return true;
  const haystack = fold(text);
  if (!haystack) return true;
  for (const engineId of subtype.excludedEngines) {
    const signal = SUBTYPE_EXCLUDED_TOPIC_SIGNALS[engineId];
    if (signal?.test(haystack)) return false;
  }
  return true;
}
