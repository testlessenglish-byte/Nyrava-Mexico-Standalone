// =============================================================================
// JURISDICTION INTELLIGENCE — pure module.
//
// Resolves, for a Mexican matter: país, entidad federativa, fuero
// (federal/común), materia, competent court family, and the substantive +
// procedural codes that actually govern the case. Consumed by the
// `jurisdiction_intel` pipeline stage ("Inteligencia de Jurisdicción"), which
// runs right after the legal analyzers so every downstream engine reasons
// against the correct body of law.
// =============================================================================

import { resolveMxProfile, type MxPipelineProfile } from "../execution/mx-pipeline";

export const MEXICAN_STATES: readonly { code: string; name: string; aliases: readonly string[] }[] = [
  { code: "AGU", name: "Aguascalientes", aliases: [] },
  { code: "BCN", name: "Baja California", aliases: ["Mexicali", "Tijuana", "Ensenada"] },
  { code: "BCS", name: "Baja California Sur", aliases: ["La Paz", "Los Cabos"] },
  { code: "CAM", name: "Campeche", aliases: [] },
  { code: "CHP", name: "Chiapas", aliases: ["Tuxtla Gutiérrez"] },
  { code: "CHH", name: "Chihuahua", aliases: ["Ciudad Juárez"] },
  { code: "CMX", name: "Ciudad de México", aliases: ["CDMX", "Distrito Federal", "Ciudad de Mexico"] },
  { code: "COA", name: "Coahuila", aliases: ["Saltillo", "Torreón"] },
  { code: "COL", name: "Colima", aliases: ["Manzanillo"] },
  { code: "DUR", name: "Durango", aliases: [] },
  { code: "GUA", name: "Guanajuato", aliases: ["León", "Celaya", "Irapuato"] },
  { code: "GRO", name: "Guerrero", aliases: ["Acapulco", "Chilpancingo"] },
  { code: "HID", name: "Hidalgo", aliases: ["Pachuca"] },
  { code: "JAL", name: "Jalisco", aliases: ["Guadalajara", "Zapopan", "Puerto Vallarta"] },
  { code: "MEX", name: "Estado de México", aliases: ["Toluca", "Ecatepec", "Naucalpan", "Nezahualcóyotl"] },
  { code: "MIC", name: "Michoacán", aliases: ["Morelia", "Uruapan"] },
  { code: "MOR", name: "Morelos", aliases: ["Cuernavaca"] },
  { code: "NAY", name: "Nayarit", aliases: ["Tepic"] },
  { code: "NLE", name: "Nuevo León", aliases: ["Monterrey", "San Pedro Garza García"] },
  { code: "OAX", name: "Oaxaca", aliases: [] },
  { code: "PUE", name: "Puebla", aliases: [] },
  { code: "QUE", name: "Querétaro", aliases: [] },
  { code: "ROO", name: "Quintana Roo", aliases: ["Cancún", "Chetumal", "Playa del Carmen"] },
  { code: "SLP", name: "San Luis Potosí", aliases: [] },
  { code: "SIN", name: "Sinaloa", aliases: ["Culiacán", "Mazatlán"] },
  { code: "SON", name: "Sonora", aliases: ["Hermosillo", "Ciudad Obregón"] },
  { code: "TAB", name: "Tabasco", aliases: ["Villahermosa"] },
  { code: "TAM", name: "Tamaulipas", aliases: ["Reynosa", "Tampico", "Ciudad Victoria"] },
  { code: "TLA", name: "Tlaxcala", aliases: [] },
  { code: "VER", name: "Veracruz", aliases: ["Xalapa", "Coatzacoalcos"] },
  { code: "YUC", name: "Yucatán", aliases: ["Mérida"] },
  { code: "ZAC", name: "Zacatecas", aliases: [] },
];

export type Fuero = "federal" | "comun" | "mixto";

export type JurisdictionProfile = {
  country: "MX";
  /** Entidad federativa, or null when the matter is purely federal. */
  state: { code: string; name: string } | null
  /** How the state was determined. */
  state_source: "case_field" | "corpus" | "unresolved";
  fuero: Fuero;
  materia: MxPipelineProfile;
  /** Court families with competence over this matter. */
  courts: readonly string[];
  /** Substantive law that governs the merits. */
  substantive_codes: readonly string[];
  /** Procedural law that governs the trámite. */
  procedural_codes: readonly string[];
  /** Constitutional hooks always in play (Art. 1º, 14, 16, etc.). */
  constitutional_basis: readonly string[];
  /** Human-readable one-liner, Spanish. */
  summary: string;
  /** Non-fatal notes (e.g. state could not be resolved). */
  notes: string[];
};

type MateriaLaw = {
  fuero: Fuero;
  courts: readonly string[];
  substantive: readonly string[];
  /** `%STATE%` is replaced with the resolved state name. */
  procedural: readonly string[];
};

const MATERIA_LAW: Record<MxPipelineProfile, MateriaLaw> = {
  penal: {
    fuero: "mixto",
    courts: ["Juez de Control", "Tribunal de Enjuiciamiento", "Tribunal de Alzada"],
    substantive: ["Código Penal Federal", "Código Penal de %STATE%", "Ley General de Víctimas"],
    procedural: ["Código Nacional de Procedimientos Penales (CNPP)", "Ley Nacional de Ejecución Penal"],
  },
  amparo: {
    fuero: "federal",
    courts: ["Juzgado de Distrito", "Tribunal Colegiado de Circuito", "SCJN"],
    substantive: ["CPEUM", "Tratados internacionales de derechos humanos"],
    procedural: ["Ley de Amparo", "Ley Orgánica del Poder Judicial de la Federación"],
  },
  derechos_humanos: {
    fuero: "mixto",
    courts: ["Juzgado de Distrito", "CNDH", "Comisión Estatal de Derechos Humanos"],
    substantive: ["CPEUM Art. 1º", "Convención Americana sobre Derechos Humanos", "Ley General de Víctimas"],
    procedural: ["Ley de Amparo", "Ley de la Comisión Nacional de los Derechos Humanos"],
  },
  laboral: {
    fuero: "mixto",
    courts: ["Tribunal Laboral", "Centro de Conciliación Laboral", "Tribunal Colegiado en Materia de Trabajo"],
    substantive: ["Ley Federal del Trabajo (LFT)", "Ley del Seguro Social"],
    procedural: ["Ley Federal del Trabajo, Título Catorce (procedimiento ordinario laboral)"],
  },
  civil: {
    fuero: "comun",
    courts: ["Juzgado Civil de Primera Instancia", "Sala Civil del Tribunal Superior de Justicia"],
    substantive: ["Código Civil Federal", "Código Civil de %STATE%"],
    procedural: ["Código Nacional de Procedimientos Civiles y Familiares", "Código de Procedimientos Civiles de %STATE%"],
  },
  familiar: {
    fuero: "comun",
    courts: ["Juzgado de lo Familiar", "Sala Familiar del Tribunal Superior de Justicia"],
    substantive: ["Código Civil de %STATE%", "Ley General de los Derechos de Niñas, Niños y Adolescentes"],
    procedural: ["Código Nacional de Procedimientos Civiles y Familiares"],
  },
  mercantil: {
    fuero: "federal",
    courts: ["Juzgado de Distrito en Materia Mercantil", "Juzgado Civil (competencia concurrente)"],
    substantive: ["Código de Comercio", "Ley General de Títulos y Operaciones de Crédito", "LGSM"],
    procedural: ["Código de Comercio (juicio ejecutivo/oral mercantil)", "Código Federal de Procedimientos Civiles"],
  },
  fiscal: {
    fuero: "federal",
    courts: ["Tribunal Federal de Justicia Administrativa (TFJA)", "Tribunal Colegiado de Circuito"],
    substantive: ["Código Fiscal de la Federación (CFF)", "Ley del ISR", "Ley del IVA"],
    procedural: ["Ley Federal de Procedimiento Contencioso Administrativo (LFPCA)"],
  },
  administrativo: {
    fuero: "mixto",
    courts: ["Tribunal Federal de Justicia Administrativa (TFJA)", "Tribunal de Justicia Administrativa de %STATE%"],
    substantive: ["Ley Federal de Procedimiento Administrativo", "Ley General de Responsabilidades Administrativas"],
    procedural: ["Ley Federal de Procedimiento Contencioso Administrativo (LFPCA)"],
  },
  apelacion: {
    fuero: "mixto",
    courts: ["Tribunal de Alzada", "Sala del Tribunal Superior de Justicia", "Tribunal Colegiado de Circuito"],
    substantive: ["Legislación sustantiva de la primera instancia"],
    procedural: ["Código procesal aplicable a la primera instancia (recurso de apelación)"],
  },
  inmobiliario: {
    fuero: "comun",
    // Not "courts" in the litigation sense — the real instancia for a
    // closing. Kept in this field because MateriaLaw has no separate slot,
    // and every other call site reads `courts` expecting a non-empty list.
    courts: ["Notario Público (fe pública)", "Registro Público de la Propiedad de %STATE%"],
    substantive: ["Código Civil de %STATE%", "Ley del Notariado de %STATE%", "Código Fiscal de la Federación / leyes fiscales locales (ISAI)"],
    procedural: ["Reglamento del Registro Público de la Propiedad de %STATE%", "Ley del Notariado de %STATE%"],
  },
  agrario: {
    // Federal jurisdiction, but "%STATE%" still applies — a Tribunal
    // Unitario Agrario sits in a specific distrito, and the RAN's local
    // delegación is state-specific.
    fuero: "federal",
    courts: ["Tribunal Unitario Agrario", "Tribunal Superior Agrario", "Registro Agrario Nacional (RAN)"],
    substantive: ["Ley Agraria", "CPEUM Art. 27"],
    procedural: ["Ley Agraria (Título Tercero — de la Justicia Agraria)", "Ley Orgánica de los Tribunales Agrarios"],
  },
  electoral: {
    fuero: "federal",
    courts: ["Instituto Nacional Electoral (INE)", "OPLE de %STATE%", "Tribunal Electoral del Poder Judicial de la Federación (TEPJF)"],
    substantive: ["LGIPE", "LGPP", "CPEUM Art. 35, 41"],
    procedural: ["Ley General del Sistema de Medios de Impugnación en Materia Electoral (LGSMIME)"],
  },
};

const CONSTITUTIONAL_BASIS: Record<MxPipelineProfile, readonly string[]> = {
  penal: ["CPEUM Art. 1º", "Art. 14", "Art. 16", "Art. 19", "Art. 20", "Art. 21"],
  amparo: ["CPEUM Art. 1º", "Art. 103", "Art. 107"],
  derechos_humanos: ["CPEUM Art. 1º", "Art. 102 apartado B"],
  laboral: ["CPEUM Art. 5º", "Art. 123 apartado A"],
  civil: ["CPEUM Art. 14", "Art. 16", "Art. 17"],
  familiar: ["CPEUM Art. 4º", "Art. 14", "Art. 16"],
  mercantil: ["CPEUM Art. 14", "Art. 16", "Art. 73 fracción X"],
  fiscal: ["CPEUM Art. 16", "Art. 31 fracción IV"],
  administrativo: ["CPEUM Art. 14", "Art. 16", "Art. 17"],
  apelacion: ["CPEUM Art. 14", "Art. 16", "Art. 17"],
  inmobiliario: ["CPEUM Art. 14", "Art. 16", "Art. 27"],
  agrario: ["CPEUM Art. 27", "Art. 2º (pueblos y comunidades indígenas)"],
  electoral: ["CPEUM Art. 35", "Art. 41", "Art. 116 fracción IV"],
};

const MATERIA_LABEL_ES: Record<MxPipelineProfile, string> = {
  penal: "penal",
  amparo: "amparo",
  derechos_humanos: "derechos humanos",
  laboral: "laboral",
  civil: "civil",
  familiar: "familiar",
  mercantil: "mercantil",
  fiscal: "fiscal",
  administrativo: "administrativa",
  apelacion: "apelación",
  inmobiliario: "inmobiliaria",
  agrario: "agraria",
  electoral: "electoral",
};

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Word-boundary search on normalized text — "GUA" must not match "Guadalajara". */
function indexOfWord(haystack: string, needle: string): number {
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
    "u",
  );
  const m = re.exec(haystack);
  return m ? m.index : -1;
}

/** Resolve entidad federativa from a free-text field or the document corpus. */
export function detectState(text: string | null | undefined): { code: string; name: string } | null {
  if (!text) return null;
  const hay = normalize(text);
  let best: { code: string; name: string; at: number } | null = null;
  for (const st of MEXICAN_STATES) {
    for (const needle of [st.name, st.code, ...st.aliases]) {
      const at = indexOfWord(hay, normalize(needle));
      if (at >= 0 && (!best || at < best.at)) best = { code: st.code, name: st.name, at };
    }
  }
  return best ? { code: best.code, name: best.name } : null;
}

/** Detect whether the corpus points to the federal or the local (común) fuero. */
export function detectFuero(text: string | null | undefined, fallback: Fuero): Fuero {
  if (!text) return fallback;
  const hay = normalize(text);
  const federal = /juzgado de distrito|tribunal colegiado|fiscalia general de la republica|fgr|tfja|scjn|fuero federal/.test(hay);
  const comun = /tribunal superior de justicia|juzgado de primera instancia|fiscalia general del estado|fuero comun|juez de control del estado/.test(hay);
  if (federal && !comun) return "federal";
  if (comun && !federal) return "comun";
  if (federal && comun) return "mixto";
  return fallback;
}

export function buildJurisdictionProfile(args: {
  caseType: string | null | undefined;
  /** cases.jurisdiction free-text field, if the attorney filled it. */
  jurisdictionField?: string | null;
  /** Concatenated extracted document text (truncated by the caller). */
  corpusText?: string | null;
}): JurisdictionProfile {
  const materia = resolveMxProfile(args.caseType);
  const law = MATERIA_LAW[materia];
  const notes: string[] = [];

  let state = detectState(args.jurisdictionField);
  let state_source: JurisdictionProfile["state_source"] = state ? "case_field" : "unresolved";
  if (!state) {
    state = detectState(args.corpusText);
    state_source = state ? "corpus" : "unresolved";
  }
  if (!state && law.fuero !== "federal") {
    notes.push(
      "No fue posible determinar la entidad federativa; el análisis aplica la legislación federal supletoria y debe confirmarse la competencia local.",
    );
  }

  const fuero = detectFuero(args.corpusText, law.fuero);
  const stateName = state?.name ?? "la entidad federativa aplicable";
  const expand = (codes: readonly string[]) =>
    codes
      .map((c) => c.replace(/%STATE%/g, stateName))
      .filter((c, i, arr) => arr.indexOf(c) === i);

  const substantive_codes = expand(law.substantive);
  const procedural_codes = expand(law.procedural);
  const courts = expand(law.courts);

  const summary =
    `Materia ${MATERIA_LABEL_ES[materia]} — fuero ${fuero === "comun" ? "común" : fuero}` +
    (state ? `, ${state.name}` : "") +
    `. Competencia: ${courts[0]}. Ley aplicable: ${[...substantive_codes, ...procedural_codes].slice(0, 3).join("; ")}.`;

  return {
    country: "MX",
    state,
    state_source,
    fuero,
    materia,
    courts,
    substantive_codes,
    procedural_codes,
    constitutional_basis: CONSTITUTIONAL_BASIS[materia],
    summary,
    notes,
  };
}
